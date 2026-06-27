// apps/api/test/key-redeem.service.spec.ts
import { KeyRedeemService } from '../src/key-redeem/key-redeem.service';

describe('KeyRedeemService.redeem', () => {
  const makeLicense = (over: Partial<any> = {}) => ({
    id: 'lic1',
    licenseKey: 'VPN-A9X2-K8LM',
    status: 'unused',
    durationDays: 30,
    activatedAt: null,
    expiredAt: null,
    ...over,
  });

  const makeKeys = () => ({
    checkKey: jest.fn(),
    consume: jest.fn(),
    recordActivation: jest.fn(),
  });
  const makeDevices = () => ({ getDeviceCode: jest.fn() });
  const makeTelegram = () => ({ sendLoginCommand: jest.fn() });

  it('rejects an invalid key before touching the device or Telegram', async () => {
    const keys = makeKeys();
    keys.checkKey.mockResolvedValue({ valid: false, code: 'invalid_key', message: 'not found', license: null });
    const devices = makeDevices();
    const telegram = makeTelegram();

    const svc = new KeyRedeemService(keys as any, devices as any, telegram as any);
    const r = await svc.redeem({ key: 'vpn-a9x2-k8lm' } as any, { ip: '1.1.1.1' });

    expect(r).toMatchObject({ success: false, code: 'invalid_key' });
    expect(devices.getDeviceCode).not.toHaveBeenCalled();
    expect(telegram.sendLoginCommand).not.toHaveBeenCalled();
  });

  it('returns device_code_unavailable when the Surfshark source fails', async () => {
    const keys = makeKeys();
    keys.checkKey.mockResolvedValue({ valid: true, code: 'success', message: 'OK', license: makeLicense() });
    const devices = makeDevices();
    devices.getDeviceCode.mockRejectedValue(new Error('ENOENT: file missing'));
    const telegram = makeTelegram();

    const svc = new KeyRedeemService(keys as any, devices as any, telegram as any);
    const r = await svc.redeem({ key: 'VPN-A9X2-K8LM' } as any, {});

    expect(r.code).toBe('device_code_unavailable');
    expect(telegram.sendLoginCommand).not.toHaveBeenCalled();
    expect(keys.consume).not.toHaveBeenCalled();
  });

  it('persists the activation and returns success on the happy path', async () => {
    const license = makeLicense();
    const keys = makeKeys();
    keys.checkKey.mockResolvedValue({ valid: true, code: 'success', message: 'OK', license });
    keys.consume.mockResolvedValue({ ...license, status: 'active', expiredAt: new Date('2030-01-01') });
    keys.recordActivation.mockResolvedValue(undefined);

    const devices = makeDevices();
    devices.getDeviceCode.mockResolvedValue('ABC123');

    const telegram = makeTelegram();
    telegram.sendLoginCommand.mockResolvedValue({ ok: true, code: 'success', message: 'ok', attempts: 1, durationMs: 50 });

    const svc = new KeyRedeemService(keys as any, devices as any, telegram as any);
    const r = await svc.redeem({ key: 'VPN-A9X2-K8LM' } as any, { ip: '1.1.1.1' });

    expect(r.success).toBe(true);
    expect(r.code).toBe('success');
    expect(r.deviceCode).toBe('AB**23'); // masked, never the raw code
    expect(keys.consume).toHaveBeenCalledWith('VPN-A9X2-K8LM', expect.stringMatching(/^redeem_/));
  });

  it('returns the Telegram error code without committing the license on bot_rejected', async () => {
    const keys = makeKeys();
    keys.checkKey.mockResolvedValue({ valid: true, code: 'success', message: 'OK', license: makeLicense() });
    const devices = makeDevices();
    devices.getDeviceCode.mockResolvedValue('ABC123');
    const telegram = makeTelegram();
    telegram.sendLoginCommand.mockResolvedValue({ ok: false, code: 'bot_rejected', message: 'expired', attempts: 3, durationMs: 1200 });

    const svc = new KeyRedeemService(keys as any, devices as any, telegram as any);
    const r = await svc.redeem({ key: 'VPN-A9X2-K8LM' } as any, {});

    expect(r.success).toBe(false);
    expect(r.code).toBe('bot_rejected');
    expect(keys.consume).not.toHaveBeenCalled();
  });
});
