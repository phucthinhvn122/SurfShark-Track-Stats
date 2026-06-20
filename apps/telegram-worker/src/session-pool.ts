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
  inFlight: number;
  total: number;
  chain: Promise<unknown>;
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
    private readonly replyTimeoutMs = 25_000,
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
          inFlight: 0,
          total: 0,
          chain: Promise.resolve(),
        };
        try {
          await client.connect();
          s.healthy = await client.checkAuthorization();
          if (s.healthy) {
            s.bot = await client.getEntity(this.botUsername);
            s.botId = (s.bot as { id?: { toString(): string } }).id?.toString() ?? null;
          }
        } catch (e) {
          s.healthy = false;
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
          // FIX (audit): on timeout, a reply that lands just after the window
          // closes would be matched to the NEXT serialized job on this session
          // (response mismatch). Drain any late bot message before releasing
          // the chain so it cannot be mis-attributed.
          if ((e as Error).message === 'TG_TIMEOUT') {
            await this.drainBotMessages(s, this.drainMs);
          }
          throw e;
        }
      });
      s.total++;
      return { text, sessionId: s.id };
    } catch (e) {
      // a session-level failure marks it unhealthy so the next job fails over
      const msg = (e as Error).message;
      if (/SESSION|AUTH|CONNECT|DISCONNECT/i.test(msg)) s.healthy = false;
      throw e;
    } finally {
      s.inFlight--;
    }
  }

  /** Register a handler, send the command, await the bot reply or TG_TIMEOUT. */
  private collectReply(s: PooledSession, command: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const filter = new NewMessage({ incoming: true });
      const handler = (event: NewMessageEvent) => {
        const senderId = event.message.senderId?.toString();
        if (senderId && s.botId && senderId === s.botId) {
          cleanup();
          resolve(event.message.message ?? '');
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('TG_TIMEOUT'));
      }, this.replyTimeoutMs);
      function cleanup() {
        clearTimeout(timer);
        s.client.removeEventHandler(handler, filter);
      }
      s.client.addEventHandler(handler, filter);
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
        if (event.message.senderId?.toString() === s.botId) {
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
          s.healthy = authed;
          if (authed && !s.bot) {
            s.bot = await s.client.getEntity(this.botUsername);
            s.botId = (s.bot as { id?: { toString(): string } }).id?.toString() ?? null;
          }
        } catch {
          s.healthy = false;
        }
      }),
    );
  }

  stats() {
    return this.sessions.map((s) => ({ id: s.id, healthy: s.healthy, inFlight: s.inFlight, total: s.total }));
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(this.sessions.map((s) => s.client.disconnect().catch(() => {})));
  }
}
