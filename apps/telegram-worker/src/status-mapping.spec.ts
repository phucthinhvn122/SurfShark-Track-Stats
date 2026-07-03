import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapBotFailureStatus, mapCommitFailureStatus, mapExhaustedJobError } from './status-mapping';

const successScan = { status: 'success' as const, message: 'Login Success' };

describe('status mapping', () => {
  it('maps bot invalid/rejected replies to invalid_code', () => {
    const status = mapBotFailureStatus('invalid', 'Code is invalid');
    assert.equal(status.state, 'invalid_code');
    assert.equal(status.error?.code, 'ERR_BOT_INVALID');
  });

  it('maps expired bot replies to expired', () => {
    const status = mapBotFailureStatus('expired', 'Code expired');
    assert.equal(status.state, 'expired');
    assert.equal(status.error?.code, 'ERR_BOT_EXPIRED');
  });

  it('does not report success when the DB commit fails after a success reply', () => {
    const status = mapCommitFailureStatus(new Error('ERR_KEY_IN_USE'), successScan);
    assert.equal(status.state, 'server_error');
    assert.equal(status.scan?.status, 'success');
    assert.equal(status.error?.code, 'ERR_KEY_IN_USE');
  });

  it('maps Telegram timeout to telegram_unavailable', () => {
    const status = mapExhaustedJobError(new Error('TG_TIMEOUT'));
    assert.equal(status.state, 'telegram_unavailable');
    assert.equal(status.error?.code, 'ERR_TELEGRAM_TIMEOUT');
  });

  it('maps missing healthy sessions to telegram_unavailable', () => {
    const status = mapExhaustedJobError(new Error('NO_HEALTHY_SESSION'));
    assert.equal(status.state, 'telegram_unavailable');
    assert.equal(status.error?.code, 'ERR_TELEGRAM_UNAVAILABLE');
  });

  it('maps unrelated worker failures to server_error instead of telegram_unavailable', () => {
    const status = mapExhaustedJobError(new Error('database write exploded'));
    assert.equal(status.state, 'server_error');
    assert.equal(status.error?.code, 'ERR_INTERNAL');
  });
});
