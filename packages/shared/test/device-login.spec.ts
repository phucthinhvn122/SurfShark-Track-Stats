// packages/shared/test/device-login.spec.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deviceLoginSchema, DEVICE_CODE_REGEX } from '../src/index';

const payload = (deviceCode: string) => ({ deviceCode, license: 'VPN-A9X2-K8LM' });

describe('deviceLoginSchema', () => {
  it('accepts a 6-char uppercase code and trims whitespace', () => {
    const r = deviceLoginSchema.parse(payload('  abcdef  '));
    assert.equal(r.deviceCode, 'ABCDEF');
    assert.equal(r.license, 'VPN-A9X2-K8LM');
  });

  it('uppercases a mixed-case code and license', () => {
    const r = deviceLoginSchema.parse({ deviceCode: 'aBc12X', license: 'vpn-a9x2-k8lm' });
    assert.equal(r.deviceCode, 'ABC12X');
    assert.equal(r.license, 'VPN-A9X2-K8LM');
  });

  it('rejects codes shorter than 6 chars', () => {
    assert.equal(deviceLoginSchema.safeParse(payload('ABCDE')).success, false);
  });

  it('rejects codes longer than 6 chars', () => {
    assert.equal(deviceLoginSchema.safeParse(payload('ABCDEFG')).success, false);
  });

  it('rejects non-alphanumeric chars', () => {
    for (const bad of ['AB-DEF', 'AB!DEF', 'AB DEF']) {
      const r = deviceLoginSchema.safeParse(payload(bad));
      assert.equal(r.success, false, `expected "${bad}" to be rejected`);
    }
  });

  it('rejects empty string', () => {
    assert.equal(deviceLoginSchema.safeParse(payload('')).success, false);
  });

  it('rejects bad license formats', () => {
    assert.equal(deviceLoginSchema.safeParse({ deviceCode: 'ABC123', license: 'BAD-KEY' }).success, false);
  });

  it('DEVICE_CODE_REGEX matches only [A-Z0-9]{6}', () => {
    for (const ok of ['ABCDEF', '123456', 'A1B2C3', 'ZZZZZZ', '000000']) {
      assert.equal(DEVICE_CODE_REGEX.test(ok), true, `expected "${ok}" to match`);
    }
    for (const bad of ['abcdef', 'ABCDE', 'ABCDEFG', 'AB-DEF', 'AB CD', 'AB!CD', '']) {
      assert.equal(DEVICE_CODE_REGEX.test(bad), false, `expected "${bad}" to be rejected`);
    }
  });
});
