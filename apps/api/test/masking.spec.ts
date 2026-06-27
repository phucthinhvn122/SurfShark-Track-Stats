// apps/api/test/masking.spec.ts
import { maskKey, maskDeviceCode, maskSession } from '../src/common/masking.util';

describe('masking helpers', () => {
  it('masks the middle of a license key (keeps first/last 4 chars)', () => {
    expect(maskKey('VPN-A9X2-K8LM')).toBe('VPN-*****K8LM');
  });
  it('returns all stars for short strings', () => {
    expect(maskKey('AB')).toBe('**');
  });
  it('masks a device code keeping only 2 chars on each side', () => {
    expect(maskDeviceCode('ABCDEF')).toBe('AB**EF');
  });
  it('always redacts the session string', () => {
    expect(maskSession('whatever')).toBe('<redacted>');
    expect(maskSession()).toBe('<redacted>');
  });
});
