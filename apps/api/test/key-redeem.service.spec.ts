// apps/api/test/key-redeem.service.spec.ts
import { KeyRedeemService } from '../src/key-redeem/key-redeem.service';
import { AppException } from '../src/common/app-exception';
import { ErrorCode } from '@surfshark/shared';
import { HttpStatus } from '@nestjs/common';

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
    reserveRedeem: jest.fn(),
    commitReservedRedeem: jest.fn(),
    markRedeemFailed: jest.fn(),
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
    expect(keys.reserveRedeem).not.toHaveBeenCalled();
  });

  it('persists the activation and returns success on the happy path', async () => {
    const license = makeLicense();
    const keys = makeKeys();
    keys.checkKey.mockResolvedValue({ valid: true, code: 'success', message: 'OK', license });
    keys.reserveRedeem.mockResolvedValue(license);
    keys.commitReservedRedeem.mockResolvedValue({ ...license, status: 'active', expiredAt: new Date('2030-01-01') });

    const devices = makeDevices();
    devices.getDeviceCode.mockResolvedValue('ABC123');

    const telegram = makeTelegram();
    telegram.sendLoginCommand.mockResolvedValue({ ok: true, code: 'success', message: 'ok', attempts: 1, durationMs: 50 });

    const svc = new KeyRedeemService(keys as any, devices as any, telegram as any);
    const r = await svc.redeem({ key: 'VPN-A9X2-K8LM' } as any, { ip: '1.1.1.1' });

    expect(r.success).toBe(true);
    expect(r.code).toBe('success');
    expect(r.deviceCode).toBe('AB**23'); // masked, never the raw code
    expect(keys.reserveRedeem).toHaveBeenCalledWith(
      'VPN-A9X2-K8LM',
      expect.objectContaining({ requestId: expect.stringMatching(/^redeem_/), deviceCode: 'ABC123' }),
    );
    expect(keys.commitReservedRedeem).toHaveBeenCalledWith('VPN-A9X2-K8LM', expect.stringMatching(/^redeem_/));
  });

  it('returns the Telegram error code without committing the license on bot_rejected', async () => {
    const keys = makeKeys();
    keys.checkKey.mockResolvedValue({ valid: true, code: 'success', message: 'OK', license: makeLicense() });
    keys.reserveRedeem.mockResolvedValue(makeLicense());
    keys.markRedeemFailed.mockResolvedValue(undefined);
    const devices = makeDevices();
    devices.getDeviceCode.mockResolvedValue('ABC123');
    const telegram = makeTelegram();
    telegram.sendLoginCommand.mockResolvedValue({ ok: false, code: 'bot_rejected', message: 'expired', attempts: 1, durationMs: 1200 });

    const svc = new KeyRedeemService(keys as any, devices as any, telegram as any);
    const r = await svc.redeem({ key: 'VPN-A9X2-K8LM' } as any, {});

    expect(r.success).toBe(false);
    expect(r.code).toBe('bot_rejected');
    expect(keys.commitReservedRedeem).not.toHaveBeenCalled();
    expect(keys.markRedeemFailed).toHaveBeenCalledWith(expect.stringMatching(/^redeem_/), 'bot_rejected');
  });

  it('returns key_in_use and does not send Telegram when duplicate redeem is already pending', async () => {
    const keys = makeKeys();
    keys.checkKey.mockResolvedValue({ valid: true, code: 'success', message: 'OK', license: makeLicense() });
    keys.reserveRedeem.mockRejectedValue(
      new AppException(ErrorCode.KEY_IN_USE, 'Key redemption is already in progress', HttpStatus.CONFLICT),
    );
    const devices = makeDevices();
    devices.getDeviceCode.mockResolvedValue('ABC123');
    const telegram = makeTelegram();

    const svc = new KeyRedeemService(keys as any, devices as any, telegram as any);
    const r = await svc.redeem({ key: 'VPN-A9X2-K8LM' } as any, {});

    expect(r).toMatchObject({ success: false, code: 'key_in_use' });
    expect(telegram.sendLoginCommand).not.toHaveBeenCalled();
    expect(keys.commitReservedRedeem).not.toHaveBeenCalled();
  });

  it('allows only one concurrent redeem to reserve and send Telegram', async () => {
    const keys = makeKeys();
    keys.checkKey.mockResolvedValue({ valid: true, code: 'success', message: 'OK', license: makeLicense() });
    keys.reserveRedeem
      .mockResolvedValueOnce(makeLicense())
      .mockRejectedValueOnce(new AppException(ErrorCode.KEY_IN_USE, 'Key redemption is already in progress', HttpStatus.CONFLICT));
    keys.commitReservedRedeem.mockResolvedValue({ ...makeLicense(), status: 'active', expiredAt: new Date('2030-01-01') });
    const devices = makeDevices();
    devices.getDeviceCode.mockResolvedValue('ABC123');
    const telegram = makeTelegram();
    telegram.sendLoginCommand.mockResolvedValue({ ok: true, code: 'success', message: 'ok', attempts: 1, durationMs: 50 });

    const svc = new KeyRedeemService(keys as any, devices as any, telegram as any);
    const [first, second] = await Promise.all([
      svc.redeem({ key: 'VPN-A9X2-K8LM' } as any, {}),
      svc.redeem({ key: 'VPN-A9X2-K8LM' } as any, {}),
    ]);

    expect(first.code).toBe('success');
    expect(second.code).toBe('key_in_use');
    expect(telegram.sendLoginCommand).toHaveBeenCalledTimes(1);
  });

  it('does not report success if the DB commit fails after Telegram success', async () => {
    const keys = makeKeys();
    keys.checkKey.mockResolvedValue({ valid: true, code: 'success', message: 'OK', license: makeLicense() });
    keys.reserveRedeem.mockResolvedValue(makeLicense());
    keys.commitReservedRedeem.mockRejectedValue(new Error('db commit failed'));
    keys.markRedeemFailed.mockResolvedValue(undefined);
    const devices = makeDevices();
    devices.getDeviceCode.mockResolvedValue('ABC123');
    const telegram = makeTelegram();
    telegram.sendLoginCommand.mockResolvedValue({ ok: true, code: 'success', message: 'ok', attempts: 1, durationMs: 50 });

    const svc = new KeyRedeemService(keys as any, devices as any, telegram as any);
    const r = await svc.redeem({ key: 'VPN-A9X2-K8LM' } as any, {});

    expect(r).toMatchObject({ success: false, code: 'internal_error' });
    expect(keys.markRedeemFailed).toHaveBeenCalledWith(expect.stringMatching(/^redeem_/), 'db commit failed');
  });
});
