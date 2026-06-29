// packages/shared/src/scan-login-result.ts
//
// Reusable login-response scanner + Telegram notifier.
//
// Scans the raw response a command produced (string OR object) and decides a
// login status, then hands back a ready-to-send Telegram message. Kept
// framework-agnostic: pass any `send` function so it works with
// node-telegram-bot-api, telegraf, GramJS, or a plain fetch to the Bot API.
//
// Rules (case-insensitive):
//   - empty / null / undefined         -> ❌ Login Failed: Empty response
//   - contains "false" or "failed"     -> ❌ Login Failed   (takes priority)
//   - contains "success"               -> ✅ Login Success
//   - none of the above                -> ⚠️ Login Status Unknown (+ raw text)
//
// Priority: if a response contains BOTH "success" and "false"/"failed", it is
// reported as Failed.

// This package targets ES2022 with no DOM/node lib; reach `console` through
// globalThis so the scanner stays usable in web, api, and worker builds alike.
const logger: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void } =
  (globalThis as { console?: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void } })
    .console ?? { log: () => {}, error: () => {} };

export type LoginScanStatus = 'success' | 'failed' | 'unknown';

export interface LoginScanResult {
  /** Coarse status derived from the response. */
  status: LoginScanStatus;
  /** Emoji-prefixed message, ready to send to Telegram. */
  message: string;
  /** Normalized raw response (object inputs are JSON.stringify'd). */
  raw: string;
}

/** Detect failure first so it wins when "success" + "false" both appear. */
const FAILED_RE = /false|failed/i;
const SUCCESS_RE = /success/i;

/** Coerce any response (string | object | unknown) into a searchable string. */
function normalize(response: unknown): string {
  if (response == null) return '';
  if (typeof response === 'string') return response;
  try {
    return JSON.stringify(response);
  } catch {
    // circular refs etc. — fall back to a primitive coercion
    return String(response);
  }
}

/**
 * Scan a finished command's response and classify the login outcome.
 * Pure + synchronous — safe to unit test and reuse anywhere.
 */
export function scanLoginResult(response: unknown): LoginScanResult {
  const raw = normalize(response).trim();
  const ts = new Date().toISOString();

  let result: LoginScanResult;
  if (raw === '') {
    result = { status: 'failed', message: '❌ Login Failed: Empty response', raw };
  } else if (FAILED_RE.test(raw)) {
    // priority: failed beats success
    result = { status: 'failed', message: '❌ Login Failed', raw };
  } else if (SUCCESS_RE.test(raw)) {
    result = { status: 'success', message: '✅ Login Success', raw };
  } else {
    result = {
      status: 'unknown',
      message: `⚠️ Login Status Unknown\n${raw}`,
      raw,
    };
  }

  // Log with timestamp for traceability.
  logger.log(`[${ts}] scanLoginResult -> ${result.status} | raw="${raw.slice(0, 200)}"`);
  return result;
}

/** Minimal sender contract — return value ignored. */
export type SendMessageFn = (text: string) => unknown | Promise<unknown>;

/**
 * Scan the response and push the status message to Telegram.
 * Returns the scan result so the caller can branch on `status` if needed.
 *
 * @example node-telegram-bot-api
 *   await notifyLoginResult(response, (text) => bot.sendMessage(chatId, text));
 *
 * @example telegraf
 *   await notifyLoginResult(response, (text) => ctx.reply(text));
 */
export async function notifyLoginResult(
  response: unknown,
  send: SendMessageFn,
): Promise<LoginScanResult> {
  const result = scanLoginResult(response);
  try {
    await send(result.message);
  } catch (err) {
    logger.error(
      `[${new Date().toISOString()}] notifyLoginResult: failed to send Telegram message:`,
      (err as Error)?.message ?? err,
    );
  }
  return result;
}
