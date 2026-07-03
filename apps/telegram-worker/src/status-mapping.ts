import { ErrorCode, type StatusResponse } from '@surfshark/shared';

export function mapBotFailureStatus(reason: string | undefined, replyText: string, scan?: StatusResponse['scan']): StatusResponse {
  if (reason === 'expired') {
    return {
      state: 'activation_expired',
      scan,
      error: { code: ErrorCode.ACTIVATION_EXPIRED, message: replyText },
    };
  }
  if (reason === 'invalid' || reason === 'failed' || reason === 'banned') {
    return {
      state: 'invalid_code',
      scan,
      error: { code: `ERR_BOT_${(reason ?? 'invalid').toUpperCase()}`, message: replyText },
    };
  }
  return {
    state: 'server_error',
    scan,
    error: { code: ErrorCode.BOT_UNRECOGNIZED, message: 'The bot replied in an unrecognised format. Please try again.' },
  };
}

export function mapCommitFailureStatus(err: unknown, scan?: StatusResponse['scan']): StatusResponse {
  const code = err instanceof Error && err.message ? err.message : ErrorCode.INTERNAL;
  return {
    state: 'server_error',
    scan,
    error: {
      code,
      message: 'Telegram confirmed the login, but the activation could not be saved. Please start a new login request.',
    },
  };
}

export function mapExhaustedJobError(err: Error): StatusResponse {
  if (err.message === 'TG_UNEXPECTED_REPLY') {
    return {
      state: 'server_error',
      error: {
        code: ErrorCode.BOT_UNRECOGNIZED,
        message: 'The bot replied in an unrecognised format. We are looking into it.',
      },
    };
  }
  if (err.message === 'TG_TIMEOUT') {
    return {
      state: 'timeout',
      error: {
        code: ErrorCode.ACTIVATION_TIMEOUT,
        message: 'The bot did not return a final result before the request timed out.',
      },
    };
  }
  if (err.message === 'TG_UNAVAILABLE') {
    return {
      state: 'telegram_unavailable',
      error: {
        code: ErrorCode.TELEGRAM_UNAVAILABLE,
        message: 'Telegram service is temporarily unavailable. Please try again in a few minutes.',
      },
    };
  }
  if (err.message === 'NO_HEALTHY_SESSION') {
    return {
      state: 'server_error',
      error: {
        code: ErrorCode.INTERNAL,
        message: 'No Telegram sessions available. Please contact the admin to rotate sessions.',
      },
    };
  }
  return {
    state: 'server_error',
    error: { code: ErrorCode.INTERNAL, message: 'Activation failed because of a backend error.' },
  };
}
