// packages/shared/test/schema.spec.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activateSchema, LICENSE_REGEX } from '../src/index';

describe('activateSchema', () => {
  it('accepts a valid payload and uppercases the key', () => {
    const r = activateSchema.parse({ username: 'thinh', license: 'vpn-a9x2-k8lm' });
    assert.equal(r.license, 'VPN-A9X2-K8LM');
  });

  it('rejects short usernames', () => {
    assert.equal(activateSchema.safeParse({ username: 'ab', license: 'VPN-A9X2-K8LM' }).success, false);
  });

  it('rejects bad license formats', () => {
    assert.equal(activateSchema.safeParse({ username: 'thinh', license: 'ABC-123' }).success, false);
  });

  it('LICENSE_REGEX matches VPN-XXXX-XXXX only', () => {
    assert.equal(LICENSE_REGEX.test('VPN-A9X2-K8LM'), true);
    assert.equal(LICENSE_REGEX.test('VPN-a9x2-k8lm'), false);
    assert.equal(LICENSE_REGEX.test('VPN-A9X2K8LM'), false);
  });
});
