// apps/api/src/key-redeem/telegram/telegram.types.ts
import type { RedeemResultCode } from '@surfshark/shared';

export interface SendLoginCommandInput {
  deviceCode: string;
  timeoutMs?: number;
}

export interface SendLoginCommandResult {
  ok: boolean;
  code: RedeemResultCode | 'telegram_rate_limited';
  message: string;
  rawReply?: string;
  attempts: number;
  durationMs: number;
}

/**
 * Pluggable interface — the API doesn't care HOW the message is sent, only
 * that it gets a structured answer. Swapping GramJS for an HTTP-call against
 * the worker is a one-line change in telegram.module.ts.
 */
export interface TelegramService {
  sendLoginCommand(input: SendLoginCommandInput): Promise<SendLoginCommandResult>;
  isReady(): boolean;
  shutdown(): Promise<void>;
}
