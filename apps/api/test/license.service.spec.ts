// apps/api/test/license.service.spec.ts
import { LicenseService } from '../src/license/license.service';
import { AppException } from '../src/common/app-exception';

// NOTE: LicenseService instantiates its own PrismaClient. In this unit test we
// stub the prisma calls it makes through the public methods by mocking the
// module. Shown here as a focused state-machine test of assertActivatable.

describe('LicenseService — state machine', () => {
  let svc: LicenseService;

  beforeEach(() => {
    // PrismaService is injected; tests stub findByKey directly so a minimal
    // fake is sufficient.
    svc = new LicenseService({} as any);
  });

  function license(over: Partial<any> = {}) {
    return {
      id: 'l1',
      licenseKey: 'VPN-A9X2-K8LM',
      username: null,
      status: 'unused',
      activatedAt: null,
      expiredAt: null,
      ...over,
    };
  }

  it('rejects a non-existent key', async () => {
    jest.spyOn(svc, 'findByKey').mockResolvedValue(null);
    await expect(svc.assertActivatable('VPN-XXXX-XXXX', 'thinh')).rejects.toBeInstanceOf(AppException);
  });

  it('rejects a banned key', async () => {
    jest.spyOn(svc, 'findByKey').mockResolvedValue(license({ status: 'banned' }) as any);
    await expect(svc.assertActivatable('VPN-A9X2-K8LM', 'thinh')).rejects.toMatchObject({
      response: { error: { code: 'ERR_KEY_BANNED' } },
    });
  });

  it('rejects a key bound to another user', async () => {
    jest.spyOn(svc, 'findByKey').mockResolvedValue(
      license({ status: 'active', username: 'lan', expiredAt: new Date(Date.now() + 1e9) }) as any,
    );
    await expect(svc.assertActivatable('VPN-A9X2-K8LM', 'thinh')).rejects.toMatchObject({
      response: { error: { code: 'ERR_KEY_IN_USE' } },
    });
  });

  it('allows an unused key', async () => {
    const l = license();
    jest.spyOn(svc, 'findByKey').mockResolvedValue(l as any);
    await expect(svc.assertActivatable('VPN-A9X2-K8LM', 'thinh')).resolves.toEqual(l);
  });

  it('allows the same user to re-activate an active key', async () => {
    const l = license({ status: 'active', username: 'thinh', expiredAt: new Date(Date.now() + 1e9) });
    jest.spyOn(svc, 'findByKey').mockResolvedValue(l as any);
    await expect(svc.assertActivatable('VPN-A9X2-K8LM', 'thinh')).resolves.toEqual(l);
  });
});
