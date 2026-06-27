// apps/api/src/key-redeem/telegram/gramjs-telegram.service.ts
//
// Userbot (MTProto) implementation of TelegramService.
//
// Lifecycle:
//   - On first use, decrypts TG_SESSION, connects, and resolves the bot entity.
//   - Serialises sends through a queue (one in-flight at a time) so replies
//     can never be matched to the wrong job — even though a key-redeem request
//     is a single user interaction.
//   - Honours a minimum delay between sends to avoid Telegram FloodWait.
//   - Retries transient failures (network/TG_TIMEOUT) with exponential backoff.
//
// Reply parser (parseBotReply) is intentionally narrow: it only acts on words
// the Surfshark bot is known to use. Anything ambiguous is surfaced as
// "bot_rejected" so the caller can show the raw reply to the user.
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { FloodWaitError } from 'telegram/errors';
import { ENV } from '../../config/config.module';
import type { AppEnv } from '../../config/env.config';
import { decryptIfEncrypted } from '../../common/crypto.util';
import { maskDeviceCode } from '../../common/masking.util';
import {
  type SendLoginCommandInput,
  type SendLoginCommandResult,
  type TelegramService,
} from './telegram.types';
import { parseBotReply } from './parse-reply';

const MIN_SEND_INTERVAL_MS = 1_500;
const DEFAULT_REPLY_TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1_000;

@Injectable()
export class GramJsTelegramService implements TelegramService, OnModuleDestroy {
  private readonly logger = new Logger('TelegramService');
  private client: TelegramClient | null = null;
  private bot: unknown = null;
  private botId: string | null = null;
  private lastSendAt = 0;
  private sendChain: Promise<unknown> = Promise.resolve();
  private connecting: Promise<void> | null = null;

  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  isReady(): boolean {
    return this.client != null && this.bot != null;
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (e) {
        this.logger.warn(`Disconnect error: ${(e as Error).message}`);
      }
      this.client = null;
      this.bot = null;
      this.botId = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  async sendLoginCommand(input: SendLoginCommandInput): Promise<SendLoginCommandResult> {
    const startedAt = Date.now();
    const command = `/login ${input.deviceCode}`;
    const replyTimeout = input.timeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const text = await this.sendAndAwait(command, replyTimeout);
        const parsed = parseBotReply(text);
        return {
          ok: parsed.ok,
          code: parsed.code,
          message: parsed.message,
          rawReply: text,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        const e = err as Error;
        const isLast = attempt === MAX_ATTEMPTS;
        const isFloodWait = err instanceof FloodWaitError;
        const floodSeconds = isFloodWait ? (err as unknown as { seconds: number }).seconds : 0;
        const isRetryable = isFloodWait || /TG_TIMEOUT|NETWORK|ENOTFOUND|ECONNRESET|TIMEOUT/i.test(e.message);

        this.logger.warn(
          `Send attempt ${attempt}/${MAX_ATTEMPTS} failed: ${e.message}` +
            (isFloodWait ? ` (flood wait ${floodSeconds}s)` : ''),
        );

        if (isLast || !isRetryable) {
          return {
            ok: false,
            code: isFloodWait ? 'telegram_rate_limited' : 'telegram_unavailable',
            message: isFloodWait
              ? `Telegram rate-limited: try again in ${floodSeconds}s`
              : e.message,
            attempts: attempt,
            durationMs: Date.now() - startedAt,
          };
        }
        await sleep(isFloodWait ? (floodSeconds + 1) * 1000 : BACKOFF_BASE_MS * attempt);
      }
    }
    // unreachable
    return { ok: false, code: 'telegram_unavailable', message: 'Unknown failure', attempts: MAX_ATTEMPTS, durationMs: Date.now() - startedAt };
  }

  /** Send one command and await the bot's reply; rate-limited + serialised. */
  private async sendAndAwait(command: string, timeoutMs: number): Promise<string> {
    await this.ensureConnected();
    await this.respectRateLimit();
    return this.serialisedSend(command, timeoutMs);
  }

  private async ensureConnected(): Promise<void> {
    if (this.isReady()) return;
    if (!this.connecting) this.connecting = this.connect();
    await this.connecting;
  }

  private async connect(): Promise<void> {
    try {
      const apiId = this.env.TG_API_ID;
      const apiHash = this.env.TG_API_HASH;
      const session = this.env.TG_SESSION;
      const botUsername = this.env.BOT_USERNAME;
      if (!apiId || !apiHash || !session) {
        throw new Error('TG_API_ID / TG_API_HASH / TG_SESSION are not configured');
      }
      this.client = new TelegramClient(new StringSession(decryptIfEncrypted(session)), apiId, apiHash, {
        connectionRetries: 5,
        retryDelay: 2_000,
      });
      await this.client.connect();
      const authorised = await this.client.checkAuthorization();
      if (!authorised) throw new Error('Telegram session is not authorised');
      this.bot = await this.client.getEntity(botUsername);
      const botEntity = this.bot as { id?: unknown };
      this.botId = botEntity.id != null ? String(botEntity.id) : null;
      if (!this.botId) throw new Error(`Could not resolve bot id for ${botUsername}`);
      this.logger.log(`Connected to Telegram and resolved bot ${botUsername}`);
    } finally {
      this.connecting = null;
    }
  }

  private async respectRateLimit(): Promise<void> {
    const wait = this.lastSendAt + MIN_SEND_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastSendAt = Date.now();
  }

  private serialisedSend(command: string, timeoutMs: number): Promise<string> {
    const next = this.sendChain.then(
      () => this.collectReply(command, timeoutMs),
      () => this.collectReply(command, timeoutMs),
    );
    this.sendChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private collectReply(command: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!this.client || !this.bot || !this.botId) {
        reject(new Error('Telegram client not connected'));
        return;
      }
      const filter = new NewMessage({ incoming: true });
      const handler = (event: NewMessageEvent) => {
        const senderId = event.message.senderId?.toString();
        if (senderId && senderId === this.botId) {
          cleanup();
          resolve(event.message.message ?? '');
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('TG_TIMEOUT'));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.client?.removeEventHandler(handler, filter);
      };
      this.client.addEventHandler(handler, filter);
      this.client
        .sendMessage(this.bot as never, { message: command })
        .catch((e: Error) => {
          cleanup();
          reject(e);
        });
      this.logger.log(`Sent ${command.replace(/[A-Z0-9]{6}/, (m) => maskDeviceCode(m))}`);
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
