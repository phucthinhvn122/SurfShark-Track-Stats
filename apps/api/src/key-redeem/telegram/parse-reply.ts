// apps/api/src/key-redeem/telegram/parse-reply.ts
// Maps a bot reply to a structured result. Only matches against words the
// Surfshark bot is known to use; everything else is reported as `bot_rejected`
// with the raw text so the caller can surface it to the user.
import type { RedeemResultCode } from '@surfshark/shared';

export interface ParsedReply {
  ok: boolean;
  code: RedeemResultCode;
  message: string;
}

const SUCCESS_PATTERN = /✅|activated|logged in|success|valid|welcome/i;
const FAIL_PATTERNS: Array<{ code: Extract<RedeemResultCode, 'bot_rejected' | 'telegram_unavailable'>; re: RegExp }> = [
  { code: 'bot_rejected', re: /banned|blocked/i },
  { code: 'bot_rejected', re: /expired/i },
  { code: 'bot_rejected', re: /invalid|not found|unknown|wrong/i },
  { code: 'bot_rejected', re: /already/i },
];

export function parseBotReply(text: string): ParsedReply {
  if (!text || typeof text !== 'string') {
    return { ok: false, code: 'bot_rejected', message: 'Empty bot reply' };
  }
  if (SUCCESS_PATTERN.test(text)) {
    return { ok: true, code: 'success', message: 'Login successful' };
  }
  for (const { code, re } of FAIL_PATTERNS) {
    if (re.test(text)) {
      return { ok: false, code, message: text.trim().slice(0, 200) };
    }
  }
  return { ok: false, code: 'bot_rejected', message: text.trim().slice(0, 200) };
}
