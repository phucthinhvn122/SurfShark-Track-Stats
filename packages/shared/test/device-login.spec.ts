// packages/shared/test/device-login.spec.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deviceLoginSchema, DEVICE_CODE_REGEX } from '../src/index';

describe('deviceLoginSchema', () => {
  it('accepts a 6-char uppercase code and trims whitespace', () => {
    const r = deviceLoginSchema.parse({ deviceCode: '  abcdef  ' });
    assert.equal(r.deviceCode, 'ABCDEF');
  });

  it('uppercases a mixed-case code', () => {
    const r = deviceLoginSchema.parse({ deviceCode: 'aBc12X' });
    assert.equal(r.deviceCode, 'ABC12X');
  });

  it('rejects codes shorter than 6 chars', () => {
    const r = deviceLoginSchema.safeParse({ deviceCode: 'ABCDE' });
    assert.equal(r.success, false);
  });

  it('rejects codes longer than 6 chars', () => {
    const r = deviceLoginSchema.safeParse({ deviceCode: 'ABCDEFG' });
    assert.equal(r.success, false);
  });

  it('rejects non-alphanumeric chars', () => {
    for (const bad of ['AB-DEF', 'AB!DEF', 'AB DEF', 'AĐCDER']) {
      const r = deviceLoginSchema.safeParse({ deviceCode: bad });
      assert.equal(r.success, false, `expected "${bad}" to be rejected`);
    }
  });

  it('rejects empty string', () => {
    assert.equal(deviceLoginSchema.safeParse({ deviceCode: '' }).success, false);
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
