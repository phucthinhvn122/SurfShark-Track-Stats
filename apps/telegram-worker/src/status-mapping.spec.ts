import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapBotFailureStatus, mapCommitFailureStatus, mapExhaustedJobError } from './status-mapping';
import { ErrorCode } from '@surfshark/shared';

const successScan = { status: 'success' as const, message: 'Login Success' };

describe('status mapping', () => {
  it('maps bot invalid/rejected replies to invalid_code', () => {
    const status = mapBotFailureStatus('invalid', 'Code is invalid');
    assert.equal(status.state, 'invalid_code');
    assert.equal(status.error?.code, 'ERR_BOT_INVALID');
  });

  it('maps expired bot replies to activation_expired', () => {
    const status = mapBotFailureStatus('expired', 'Code expired');
    assert.equal(status.state, 'activation_expired');
    assert.equal(status.error?.code, ErrorCode.ACTIVATION_EXPIRED);
  });

  it('does not report success when the DB commit fails after a success reply', () => {
    const status = mapCommitFailureStatus(new Error('ERR_KEY_IN_USE'), successScan);
    assert.equal(status.state, 'server_error');
    assert.equal(status.scan?.status, 'success');
    assert.equal(status.error?.code, 'ERR_KEY_IN_USE');
  });

  it('maps Telegram timeout to server_error with ACTIVATION_TIMEOUT code', () => {
    const status = mapExhaustedJobError(new Error('TG_TIMEOUT'));
    assert.equal(status.state, 'timeout');
    assert.equal(status.error?.code, ErrorCode.ACTIVATION_TIMEOUT);
  });

  it('maps TG_UNAVAILABLE to telegram_unavailable', () => {
    const status = mapExhaustedJobError(new Error('TG_UNAVAILABLE'));
    assert.equal(status.state, 'telegram_unavailable');
    assert.equal(status.error?.code, ErrorCode.TELEGRAM_UNAVAILABLE);
  });

  it('maps NO_HEALTHY_SESSION to server_error (not telegram_unavailable)', () => {
    const status = mapExhaustedJobError(new Error('NO_HEALTHY_SESSION'));
    assert.equal(status.state, 'server_error');
    assert.equal(status.error?.code, ErrorCode.INTERNAL);
  });

  it('maps TG_UNEXPECTED_REPLY to server_error with BOT_UNRECOGNIZED', () => {
    const status = mapExhaustedJobError(new Error('TG_UNEXPECTED_REPLY'));
    assert.equal(status.state, 'server_error');
    assert.equal(status.error?.code, ErrorCode.BOT_UNRECOGNIZED);
  });

  it('maps unrelated worker failures to server_error', () => {
    const status = mapExhaustedJobError(new Error('database write exploded'));
    assert.equal(status.state, 'server_error');
    assert.equal(status.error?.code, ErrorCode.INTERNAL);
  });
});
