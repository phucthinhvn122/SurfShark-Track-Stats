// apps/api/test/activation.service.spec.ts
import { ActivationService } from '../src/activation/activation.service';

describe('ActivationService.activate', () => {
  const prisma = { activation: { findUnique: jest.fn() } } as any;
  const licenses = { reserveActivation: jest.fn(), failReservedActivation: jest.fn() } as any;
  const queue = { enqueue: jest.fn() } as any;
  const status = { set: jest.fn(), get: jest.fn() } as any;

  // We bypass the internal prisma.activation.create by mocking the module-level
  // PrismaClient via jest. For brevity this test focuses on orchestration:
  // validate -> enqueue -> processing state.
  let svc: ActivationService;

  beforeEach(() => {
    jest.clearAllMocks();
    licenses.reserveActivation.mockResolvedValue({ id: 'l1', licenseKey: 'VPN-A9X2-K8LM' });
    licenses.failReservedActivation.mockResolvedValue(undefined);
    svc = new ActivationService(prisma, licenses, queue, status);
    // mock the prisma write the service performs
    (svc as any).activate = ActivationService.prototype.activate.bind(svc);
  });

  it('validates the key before enqueueing', async () => {
    // reserveActivation must run; if it throws the job must NOT enqueue
    licenses.reserveActivation.mockRejectedValueOnce(new Error('ERR_KEY_BANNED'));
    await expect(
      svc.activate({ deviceCode: 'ABC123', license: 'VPN-A9X2-K8LM' } as any, {}),
    ).rejects.toThrow();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues a device login only after the key exists', async () => {
    status.set.mockResolvedValueOnce(undefined);
    queue.enqueue.mockResolvedValueOnce(undefined);

    await expect(
      svc.activate({ deviceCode: 'ABC123', license: 'VPN-A9X2-K8LM' } as any, {}),
    ).resolves.toMatchObject({ state: 'pending' });

    expect(licenses.reserveActivation).toHaveBeenCalledWith(
      'VPN-A9X2-K8LM',
      expect.objectContaining({ deviceCode: 'ABC123' }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ deviceCode: 'ABC123', licenseKey: 'VPN-A9X2-K8LM' }),
    );
  });

  it('marks the reserved activation failed when enqueue fails', async () => {
    queue.enqueue.mockRejectedValueOnce(new Error('redis down'));
    status.set.mockResolvedValue(undefined);

    await expect(
      svc.activate({ deviceCode: 'ABC123', license: 'VPN-A9X2-K8LM' } as any, {}),
    ).rejects.toMatchObject({
      response: {
        error: {
          code: 'ERR_INTERNAL',
          message: 'Activation could not be queued. Please start a new login request.',
        },
      },
    });

    expect(licenses.reserveActivation).toHaveBeenCalled();
    expect(licenses.failReservedActivation).toHaveBeenCalledWith(expect.stringMatching(/^req_/), 'redis down');
  });

  it('does not fail the request when pending status cache write fails after enqueue', async () => {
    queue.enqueue.mockResolvedValueOnce(undefined);
    status.set.mockRejectedValueOnce(new Error('status redis down'));

    await expect(
      svc.activate({ deviceCode: 'ABC123', license: 'VPN-A9X2-K8LM' } as any, {}),
    ).resolves.toMatchObject({ state: 'pending' });

    expect(licenses.failReservedActivation).not.toHaveBeenCalled();
  });

  it('returns pending while the worker has not confirmed yet', async () => {
    status.get.mockResolvedValueOnce(null);
    prisma.activation.findUnique.mockResolvedValueOnce({
      result: 'pending',
      createdAt: new Date(Date.now() - 30_000), // 30 seconds ago — within timeout window
      deviceCode: 'ABC123',
      license: { licenseKey: 'VPN-A9X2-K8LM', durationDays: 30, activatedAt: null, expiredAt: null },
    });

    await expect(svc.getStatus('req_pending')).resolves.toEqual({ state: 'pending' });
  });

  it('returns success after the worker commits the activation', async () => {
    status.get.mockResolvedValueOnce(null);
    prisma.activation.findUnique.mockResolvedValueOnce({
      result: 'success',
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
      deviceCode: 'ABC123',
      license: {
        licenseKey: 'VPN-A9X2-K8LM',
        durationDays: 30,
        activatedAt: new Date('2026-07-03T01:00:00.000Z'),
        expiredAt: new Date('2026-08-02T01:00:00.000Z'),
      },
    });

    await expect(svc.getStatus('req_success')).resolves.toMatchObject({
      state: 'success',
      deviceCode: 'ABC123',
      licenseKey: 'VPN-A9X2-K8LM',
      durationDays: 30,
      activatedAt: '2026-07-03T01:00:00.000Z',
      expiredAt: '2026-08-02T01:00:00.000Z',
    });
  });

  it('returns cached invalid_code without collapsing it to a generic failure', async () => {
    status.get.mockResolvedValueOnce({
      state: 'invalid_code',
      error: { code: 'ERR_BOT_INVALID', message: 'Invalid code' },
    });

    await expect(svc.getStatus('req_invalid')).resolves.toMatchObject({
      state: 'invalid_code',
      error: { code: 'ERR_BOT_INVALID' },
    });
    expect(prisma.activation.findUnique).not.toHaveBeenCalled();
  });

  it('returns cached telegram_unavailable without using a bot rejection state', async () => {
    status.get.mockResolvedValueOnce({
      state: 'telegram_unavailable',
      error: { code: 'ERR_TELEGRAM_UNAVAILABLE', message: 'Telegram service is temporarily unavailable.' },
    });

    await expect(svc.getStatus('req_tg_down')).resolves.toMatchObject({
      state: 'telegram_unavailable',
      error: { code: 'ERR_TELEGRAM_UNAVAILABLE' },
    });
  });

  it('returns cached timeout state', async () => {
    status.get.mockResolvedValueOnce({
      state: 'timeout',
      error: { code: 'ERR_ACTIVATION_TIMEOUT', message: 'Login confirmation timed out.' },
    });

    await expect(svc.getStatus('req_timeout')).resolves.toMatchObject({
      state: 'timeout',
      error: { code: 'ERR_ACTIVATION_TIMEOUT' },
    });
    expect(prisma.activation.findUnique).not.toHaveBeenCalled();
  });

  it('returns cached activation_expired state', async () => {
    status.get.mockResolvedValueOnce({
      state: 'activation_expired',
      error: { code: 'ERR_ACTIVATION_EXPIRED', message: 'Code has expired.' },
    });

    await expect(svc.getStatus('req_expired')).resolves.toMatchObject({
      state: 'activation_expired',
      error: { code: 'ERR_ACTIVATION_EXPIRED' },
    });
    expect(prisma.activation.findUnique).not.toHaveBeenCalled();
  });

  it('returns timeout when pending activation exceeds limit', async () => {
    status.get.mockResolvedValueOnce(null);
    const oldDate = new Date(Date.now() - 200_000); // > 3 minutes ago
    prisma.activation.findUnique.mockResolvedValueOnce({
      result: 'pending',
      createdAt: oldDate,
      deviceCode: 'ABC123',
      license: { licenseKey: 'VPN-A9X2-K8LM', durationDays: 30, activatedAt: null, expiredAt: null },
    });

    await expect(svc.getStatus('req_pending_old')).resolves.toMatchObject({
      state: 'timeout',
      error: { code: 'ERR_ACTIVATION_TIMEOUT' },
    });
  });

  it('falls back to server_error for an old failed DB row after cache expiry', async () => {
    status.get.mockResolvedValueOnce(null);
    prisma.activation.findUnique.mockResolvedValueOnce({
      result: 'failed',
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
      deviceCode: 'ABC123',
      license: { licenseKey: 'VPN-A9X2-K8LM', durationDays: 30, activatedAt: null, expiredAt: null },
    });

    await expect(svc.getStatus('req_failed')).resolves.toMatchObject({
      state: 'server_error',
      error: { code: 'ERR_INTERNAL' },
    });
  });
});
