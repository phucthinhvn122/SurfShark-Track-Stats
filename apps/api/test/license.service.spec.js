"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const license_service_1 = require("../src/license/license.service");
const app_exception_1 = require("../src/common/app-exception");
describe('LicenseService — state machine', () => {
    let svc;
    beforeEach(() => {
        svc = new license_service_1.LicenseService({});
    });
    function license(over = {}) {
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
        await expect(svc.assertActivatable('VPN-XXXX-XXXX', 'thinh')).rejects.toBeInstanceOf(app_exception_1.AppException);
    });
    it('rejects a banned key', async () => {
        jest.spyOn(svc, 'findByKey').mockResolvedValue(license({ status: 'banned' }));
        await expect(svc.assertActivatable('VPN-A9X2-K8LM', 'thinh')).rejects.toMatchObject({
            response: { error: { code: 'ERR_KEY_BANNED' } },
        });
    });
    it('rejects a key bound to another user', async () => {
        jest.spyOn(svc, 'findByKey').mockResolvedValue(license({ status: 'active', username: 'lan', expiredAt: new Date(Date.now() + 1e9) }));
        await expect(svc.assertActivatable('VPN-A9X2-K8LM', 'thinh')).rejects.toMatchObject({
            response: { error: { code: 'ERR_KEY_IN_USE' } },
        });
    });
    it('allows an unused key', async () => {
        const l = license();
        jest.spyOn(svc, 'findByKey').mockResolvedValue(l);
        await expect(svc.assertActivatable('VPN-A9X2-K8LM', 'thinh')).resolves.toEqual(l);
    });
    it('allows the same user to re-activate an active key', async () => {
        const l = license({ status: 'active', username: 'thinh', expiredAt: new Date(Date.now() + 1e9) });
        jest.spyOn(svc, 'findByKey').mockResolvedValue(l);
        await expect(svc.assertActivatable('VPN-A9X2-K8LM', 'thinh')).resolves.toEqual(l);
    });
});
//# sourceMappingURL=license.service.spec.js.map