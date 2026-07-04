// apps/web/lib/describe-activation-state.ts
import type { ActivationState, StatusResponse } from '@surfshark/shared';

export interface ActivationFailureDetail {
  title: string;
  message: string;
  code?: string;
}

const FAILURE_TITLES: Partial<Record<ActivationState, string>> = {
  timeout: 'Login confirmation timed out',
  activation_expired: 'Activation code expired',
  expired: 'Activation code expired',
  invalid_code: 'Activation code rejected',
  telegram_unavailable: 'Activation service unavailable',
  server_error: 'Activation could not be completed',
};

/** Maps a non-success StatusResponse to copy shown on the failure card.
 *  Same behavior as before the extraction — only the types changed. */
export function describeActivationFailure(data?: Pick<StatusResponse, 'state' | 'error'>): ActivationFailureDetail {
  if (!data) {
    return {
      title: 'Status unavailable',
      message: 'Could not reach the activation API. Please try again.',
      code: 'ERR_STATUS_UNAVAILABLE',
    };
  }

  const message = data.error?.message ?? 'Please start a new login request.';
  const title = (data.state && FAILURE_TITLES[data.state]) ?? 'Login failed';
  return { title, message, code: data.error?.code };
}
