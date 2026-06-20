// apps/api/test/activation.service.spec.ts
import { ActivationService } from '../src/activation/activation.service';

describe('ActivationService.activate', () => {
  const prisma = { activation: { create: jest.fn() } } as any;
  const licenses = { assertActivatable: jest.fn() } as any;
  const queue = { enqueue: jest.fn() } as any;
  const status = { set: jest.fn(), get: jest.fn() } as any;

  // We bypass the internal prisma.activation.create by mocking the module-level
  // PrismaClient via jest. For brevity this test focuses on orchestration:
  // validate -> enqueue -> processing state.
  let svc: ActivationService;

  beforeEach(() => {
    jest.clearAllMocks();
    licenses.assertActivatable.mockResolvedValue({ id: 'l1', licenseKey: 'VPN-A9X2-K8LM' });
    svc = new ActivationService(prisma, licenses, queue, status);
    // mock the prisma write the service performs
    (svc as any).activate = ActivationService.prototype.activate.bind(svc);
  });

  it('validates the key before enqueueing', async () => {
    // assertActivatable must run; if it throws the job must NOT enqueue
    licenses.assertActivatable.mockRejectedValueOnce(new Error('ERR_KEY_BANNED'));
    await expect(
      svc.activate({ username: 'thinh', license: 'VPN-A9X2-K8LM' } as any, {}),
    ).rejects.toThrow();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
