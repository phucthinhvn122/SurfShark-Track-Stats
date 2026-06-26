"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const activation_service_1 = require("../src/activation/activation.service");
describe('ActivationService.activate', () => {
    const prisma = { activation: { create: jest.fn() } };
    const licenses = { assertActivatable: jest.fn() };
    const queue = { enqueue: jest.fn() };
    const status = { set: jest.fn(), get: jest.fn() };
    let svc;
    beforeEach(() => {
        jest.clearAllMocks();
        licenses.assertActivatable.mockResolvedValue({ id: 'l1', licenseKey: 'VPN-A9X2-K8LM' });
        svc = new activation_service_1.ActivationService(prisma, licenses, queue, status);
        svc.activate = activation_service_1.ActivationService.prototype.activate.bind(svc);
    });
    it('validates the key before enqueueing', async () => {
        licenses.assertActivatable.mockRejectedValueOnce(new Error('ERR_KEY_BANNED'));
        await expect(svc.activate({ username: 'thinh', license: 'VPN-A9X2-K8LM' }, {})).rejects.toThrow();
        expect(queue.enqueue).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=activation.service.spec.js.map