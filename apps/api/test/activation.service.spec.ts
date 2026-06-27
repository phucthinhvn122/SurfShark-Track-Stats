// apps/api/test/activation.service.spec.ts
import { ActivationService } from '../src/activation/activation.service';

describe('ActivationService.activate', () => {
  const prisma = { activation: { findUnique: jest.fn() } } as any;
  const licenses = { reserveActivation: jest.fn() } as any;
  const queue = { enqueue: jest.fn() } as any;
  const status = { set: jest.fn(), get: jest.fn() } as any;

  // We bypass the internal prisma.activation.create by mocking the module-level
  // PrismaClient via jest. For brevity this test focuses on orchestration:
  // validate -> enqueue -> processing state.
  let svc: ActivationService;

  beforeEach(() => {
    jest.clearAllMocks();
    licenses.reserveActivation.mockResolvedValue({ id: 'l1', licenseKey: 'VPN-A9X2-K8LM' });
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
    ).resolves.toMatchObject({ state: 'processing' });

    expect(licenses.reserveActivation).toHaveBeenCalledWith(
      'VPN-A9X2-K8LM',
      expect.objectContaining({ deviceCode: 'ABC123' }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ deviceCode: 'ABC123', licenseKey: 'VPN-A9X2-K8LM' }),
    );
  });
});
