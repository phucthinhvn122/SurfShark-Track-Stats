// packages/shared/test/schema.spec.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activateSchema, bulkCreateSchema, LICENSE_REGEX } from '../src/index';

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

describe('bulkCreateSchema', () => {
  it('accepts supported key durations', () => {
    for (const durationDays of [0, 7, 14, 30, 365, 3650]) {
      const r = bulkCreateSchema.parse({ count: 1, durationDays });
      assert.equal(r.durationDays, durationDays);
    }
  });

  it('defaults generated keys to 30 days', () => {
    const r = bulkCreateSchema.parse({ count: 1 });
    assert.equal(r.durationDays, 30);
  });

  it('rejects unsupported key durations', () => {
    assert.equal(bulkCreateSchema.safeParse({ count: 1, durationDays: -1 }).success, false);
    assert.equal(bulkCreateSchema.safeParse({ count: 1, durationDays: 3651 }).success, false);
    assert.equal(bulkCreateSchema.safeParse({ count: 1, durationDays: 1.5 }).success, false);
  });
});
