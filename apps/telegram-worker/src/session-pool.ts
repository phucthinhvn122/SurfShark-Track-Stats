// apps/telegram-worker/src/session-pool.ts
//
// Enterprise Telegram Session Pool.
// - Holds N independent MTProto user sessions, each with its own TelegramClient.
// - Per-session serialization (one in-flight request per session) so replies
//   can never be matched to the wrong job — but the POOL runs sessions in
//   parallel, so effective concurrency == number of healthy sessions.
// - Least-busy selection (rate balancing), automatic failover to healthy
//   sessions, periodic health checks, and cached bot entity per session.
//
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { isIntermediateReply } from '@surfshark/shared';

export interface PoolSendResult {
  text: string;
  sessionId: number;
}

interface PooledSession {
  id: number;
  client: TelegramClient;
  bot: unknown | null;
  botId: string | null;
  healthy: boolean;
  lastError: string | null;
  inFlight: number;
  total: number;
  chain: Promise<unknown>;
}

function extractDeviceCode(command: string): string | null {
  const match = command.match(/^\/login\s+([A-Z0-9]{6})\b/i);
  return match?.[1]?.toUpperCase() ?? null;
}

/**
 * Coerce a Telegram peer/senderId (which may be a number, bigint, GramJS Long,
 * or a Peer/InputPeer object) to a canonical string ID. This is more reliable
 * than `event.message.senderId?.toString()`, whose output depends on the GramJS
 * version and the message type.
 */
function peerIdToString(peer: unknown): string | null {
  if (peer == null) return null;
  if (typeof peer === 'string') return peer;
  if (typeof peer === 'number') return String(peer);
  if (typeof peer === 'bigint') return peer.toString();
  if (typeof peer !== 'object') return null;
  const p = peer as Record<string, unknown>;
  // PeerUser / InputPeerUser: { userId: Long } or { userId: number }
  if (p.userId !== undefined && p.userId !== null) {
    return typeof p.userId === 'object' && p.userId !== null && 'toString' in (p.userId as object)
      ? (p.userId as { toString: () => string }).toString()
      : String(p.userId);
  }
  if (p.chatId !== undefined && p.chatId !== null) {
    return typeof p.chatId === 'object' && p.chatId !== null && 'toString' in (p.chatId as object)
      ? (p.chatId as { toString: () => string }).toString()
      : String(p.chatId);
  }
  if (p.channelId !== undefined && p.channelId !== null) {
    return typeof p.channelId === 'object' && p.channelId !== null && 'toString' in (p.channelId as object)
      ? (p.channelId as { toString: () => string }).toString()
      : String(p.channelId);
  }
  if (p.id !== undefined && p.id !== null) {
    if (typeof p.id === 'object' && p.id !== null) {
      if ('toString' in (p.id as object)) return (p.id as { toString: () => string }).toString();
    }
    return String(p.id);
  }
  if (typeof (p as { toString?: () => string }).toString === 'function') {
    const s = (p as { toString: () => string }).toString();
    // GramJS toString() on Peer objects often returns "PeerUser({...})" or similar
    // - try to extract the numeric ID from inside the parentheses.
    const m = s.match(/(\d{4,})/);
    if (m) return m[1];
    return s;
  }
  return null;
}

export class SessionPool {
  private sessions: PooledSession[] = [];
  private rr = 0;
  private readonly drainMs = 3000;

  constructor(
    private readonly apiId: number,
    private readonly apiHash: string,
    private readonly botUsername: string,
    private readonly sessionStrings: string[],
    private readonly replyTimeoutMs = 60_000,
    // Hard cap across all messages of one send. 45s covers a healthy
    // bot round-trip (~3-10s) plus a generous safety margin; any longer
    // and the user has been staring at the waiting screen too long.
    private readonly maxReplyWaitMs = 45_000,
  ) {}

  /** Connect every session and resolve the bot entity once per session. */
  async init(): Promise<void> {
    this.sessions = await Promise.all(
      this.sessionStrings.map(async (str, id) => {
        const client = new TelegramClient(new StringSession(str), this.apiId, this.apiHash, {
          connectionRetries: 5,
          retryDelay: 2000,
        });
        const s: PooledSession = {
          id,
          client,
          bot: null,
          botId: null,
          healthy: false,
          lastError: null,
          inFlight: 0,
          total: 0,
          chain: Promise.resolve(),
        };
        try {
          await client.connect();
          s.healthy = await client.checkAuthorization();
          if (s.healthy) {
            await this.resolveBot(s);
            s.lastError = null;
          } else {
            s.lastError = 'Telegram session is not authorized';
          }
        } catch (e) {
          s.healthy = false;
          s.lastError = this.errorMessage(e);
          // eslint-disable-next-line no-console
          console.error(`Session #${id} init failed:`, (e as Error).message);
        }
        return s;
      }),
    );
    // eslint-disable-next-line no-console
    console.log(`SessionPool ready: ${this.healthyCount}/${this.sessions.length} sessions healthy`);
  }

  get healthyCount(): number {
    return this.sessions.filter((s) => s.healthy).length;
  }

  get size(): number {
    return this.sessions.length;
  }

  /** Least-busy healthy session (rate balancing); round-robin on ties. */
  private pick(): PooledSession | null {
    const healthy = this.sessions.filter((s) => s.healthy);
    if (healthy.length === 0) return null;
    healthy.sort((a, b) => a.inFlight - b.inFlight);
    const minInFlight = healthy[0].inFlight;
    const candidates = healthy.filter((s) => s.inFlight === minInFlight);
    const chosen = candidates[this.rr % candidates.length];
    this.rr++;
    return chosen;
  }

  /** Serialize on a single session's chain so only one reply is awaited at a time. */
  private runExclusive<T>(s: PooledSession, fn: () => Promise<T>): Promise<T> {
    const next = s.chain.then(fn, fn);
    s.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * Send a command and await the bot reply. Automatically fails over across
   * healthy sessions; throws NO_HEALTHY_SESSION if none are available, or
   * TG_TIMEOUT if the chosen session does not reply in time.
   */
  async sendAndAwaitReply(command: string): Promise<PoolSendResult> {
    const s = this.pick();
    if (!s) throw new Error('NO_HEALTHY_SESSION');

    s.inFlight++;
    try {
      const text = await this.runExclusive(s, async () => {
        try {
          return await this.collectReply(s, command);
        } catch (e) {
          if ((e as Error).message === 'TG_TIMEOUT') {
            // FIX (audit): on timeout, a reply that lands just after the window
            // closes would be matched to the NEXT serialized job on this session
            // (response mismatch). Drain any late bot message before releasing
            // the chain so it cannot be mis-attributed.
            await this.drainBotMessages(s, this.drainMs);
            // FIX (race): the bot may have already replied before our handler
            // was attached (e.g. the user manually sent the same /login code in
            // their personal Telegram first, or the bot replied on a sibling
            // MTProto session). Fall back to chat history and look for any
            // recent bot message that mentions the device code.
            const recovered = await this.findRecentBotReply(s, command);
            if (recovered) {
              // eslint-disable-next-line no-console
              console.log(`Session #${s.id}: recovered bot reply from chat history after timeout len=${recovered.length}`);
              return recovered;
            }
          }
          throw e;
        }
      });
      s.total++;
      return { text, sessionId: s.id };
    } catch (e) {
      // a session-level failure marks it unhealthy so the next job fails over
      const msg = (e as Error).message;
      if (/SESSION|AUTH|CONNECT|DISCONNECT/i.test(msg)) {
        s.healthy = false;
        s.lastError = msg;
      }
      throw e;
    } finally {
      s.inFlight--;
    }
  }

  /**
   * Last-resort: scan the recent chat history for a bot message that mentions
   * the device code. Used when the live handler missed the reply (e.g. because
   * the user also sent /login manually, so the bot processed the first sender
   * and our session only got the second /login which the bot ignored).
   */
  private async findRecentBotReply(s: PooledSession, command: string): Promise<string | null> {
    const expectedCode = extractDeviceCode(command);
    if (!s.bot || !expectedCode) return null;
    try {
      const messages = await s.client.getMessages(s.bot as any, { limit: 12 });
      // Walk newest -> oldest, skip intermediate "processing" placeholders, and
      // return the first message that mentions the device code (a true result).
      for (const m of messages as Array<{ message?: string; senderId?: unknown; date?: number }>) {
        const text = m.message ?? '';
        if (!text) continue;
        if (!text.toUpperCase().includes(expectedCode)) continue;
        if (isIntermediateReply(text)) continue;
        // Found a terminal bot message that mentions the device code.
        // eslint-disable-next-line no-console
        console.log(`Session #${s.id}: found recent bot reply in chat history text="${text.slice(0, 80)}"`);
        return text;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Session #${s.id}: chat history fetch failed: ${(e as Error).message}`);
    }
    return null;
  }

  /**
   * Register a handler, send the command, await the bot's terminal reply or
   * TG_TIMEOUT. The bot first acks with a transient "⏳ Đang xử lý…" placeholder
   * and only later sends the real outcome, so intermediate replies are skipped
   * (re-arming the per-message inactivity timer) and we resolve on the first
   * terminal message — bounded by an absolute deadline.
   */
  private collectReply(s: PooledSession, command: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const filter = new NewMessage({ incoming: true });
      const expectedCode = extractDeviceCode(command);
      const deadline = Date.now() + this.maxReplyWaitMs;
      let sawBotMessage = false;
      let timer: ReturnType<typeof setTimeout>;
      const arm = () => {
        const windowMs = sawBotMessage ? this.replyTimeoutMs : this.maxReplyWaitMs;
        const remaining = Math.max(0, Math.min(windowMs, deadline - Date.now()));
        timer = setTimeout(() => {
          cleanup();
          reject(new Error('TG_TIMEOUT'));
        }, remaining);
      };
      const handler = (event: NewMessageEvent) => {
        const senderId = peerIdToString(event.message.senderId);
        const text = event.message.message ?? '';
        const fromBot = Boolean(senderId && s.botId && senderId === s.botId);
        const mentionsExpectedCode = Boolean(expectedCode && text.toUpperCase().includes(expectedCode));
        if (!fromBot && !mentionsExpectedCode) return;
        if (!fromBot && mentionsExpectedCode) {
          // Some Telegram updates do not expose the expected bot sender metadata.
          // A code-bearing reply is still the result for this serialized command.
          // eslint-disable-next-line no-console
          console.warn(`Session #${s.id}: accepting bot reply by device-code match senderId=${senderId} botId=${s.botId}`);
        }
        sawBotMessage = true;
        // Skip the placeholder ack and keep waiting for the real result, as long
        // as we're still within the absolute deadline.
        if (isIntermediateReply(text) && Date.now() < deadline) {
          clearTimeout(timer);
          arm();
          return;
        }
        cleanup();
        resolve(text);
      };
      function cleanup() {
        clearTimeout(timer);
        s.client.removeEventHandler(handler, filter);
      }
      s.client.addEventHandler(handler, filter);
      arm();
      void s.client.sendMessage(s.bot as any, { message: command }).catch((e) => {
        cleanup();
        reject(e);
      });
    });
  }

  /** Briefly consume & discard incoming bot messages (late-reply guard). */
  private drainBotMessages(s: PooledSession, ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (!s.botId) return resolve();
      const filter = new NewMessage({ incoming: true });
      const handler = (event: NewMessageEvent) => {
        if (peerIdToString(event.message.senderId) === s.botId) {
          // eslint-disable-next-line no-console
          console.warn(`Session #${s.id}: discarded late bot reply after timeout`);
        }
      };
      s.client.addEventHandler(handler, filter);
      setTimeout(() => {
        s.client.removeEventHandler(handler, filter);
        resolve();
      }, ms);
    });
  }

  /** Re-check authorization + reconnect each session; refresh bot entity. */
  async healthCheck(): Promise<void> {
    await Promise.all(
      this.sessions.map(async (s) => {
        try {
          if (!s.client.connected) await s.client.connect();
          const authed = await s.client.checkAuthorization();
          if (!authed) {
            s.healthy = false;
            s.lastError = 'Telegram session is not authorized';
            return;
          }
          if (!s.bot || !s.botId) await this.resolveBot(s);
          s.healthy = true;
          s.lastError = null;
        } catch (e) {
          s.healthy = false;
          s.lastError = this.errorMessage(e);
        }
      }),
    );
  }

  stats() {
    return this.sessions.map((s) => ({
      id: s.id,
      healthy: s.healthy,
      lastError: s.lastError,
      inFlight: s.inFlight,
      total: s.total,
    }));
  }

  async sendMessage(sessionId: number, message: string): Promise<void> {
    const s = this.sessions.find((x) => x.id === sessionId);
    if (!s) throw new Error(`Session #${sessionId} not found`);
    if (!s.bot) throw new Error(`Session #${sessionId} bot entity not resolved`);
    await s.client.sendMessage(s.bot as any, { message });
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(this.sessions.map((s) => s.client.disconnect().catch(() => {})));
  }

  private async resolveBot(s: PooledSession): Promise<void> {
    s.bot = await s.client.getEntity(this.botUsername);
    s.botId = (s.bot as { id?: { toString(): string } }).id?.toString() ?? null;
    if (!s.botId) throw new Error(`Could not resolve bot id for ${this.botUsername}`);
  }

  private errorMessage(e: unknown): string {
    return ((e as Error).message || String(e)).slice(0, 240);
  }
}
