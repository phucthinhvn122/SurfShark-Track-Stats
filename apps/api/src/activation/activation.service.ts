// apps/api/src/activation/activation.service.ts
import { Injectable, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { LicenseService } from '../license/license.service';
import { ActivationQueueService } from '../telegram/activation-queue.service';
import { StatusStore } from './status.store';
import { AppException } from '../common/app-exception';
import { ErrorCode, type ActivateInput, type StatusResponse } from '@surfshark/shared';

@Injectable()
export class ActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly licenses: LicenseService,
    private readonly queue: ActivationQueueService,
    private readonly status: StatusStore,
  ) {}

  /**
   * Step 1–5 of the business flow. Validates the key (DB), records a pending
   * activation, enqueues the Telegram job, and returns fast (HTTP < 500ms).
   */
  async activate(input: ActivateInput, meta: { ip?: string; ua?: string; country?: string }) {
    // gate: key must be activatable (throws on banned/expired/in-use/not-found)
    const license = await this.licenses.assertActivatable(input.license, input.username);

    const requestId = `req_${randomUUID()}`;
    await this.prisma.activation.create({
      data: {
        licenseId: license.id,
        requestId,
        username: input.username,
        ipAddress: meta.ip,
        country: meta.country,
        device: meta.ua,
        result: 'pending',
      },
    });

    await this.status.set(requestId, { state: 'processing' });
    await this.queue.enqueue({ requestId, licenseKey: input.license, username: input.username });

    return { requestId, state: 'processing' as const };
  }

  /** Step 7: frontend polls this until the state is terminal. */
  async getStatus(requestId: string): Promise<StatusResponse> {
    const cached = await this.status.get(requestId);
    if (cached) return cached;

    // fallback to DB if cache expired
    const act = await this.prisma.activation.findUnique({
      where: { requestId },
      include: { license: true },
    });
    if (!act) throw new AppException(ErrorCode.KEY_NOT_FOUND, 'Request not found', HttpStatus.NOT_FOUND);

    if (act.result === 'pending') return { state: 'processing' };
    if (act.result === 'failed')
      return { state: 'failed', error: { code: ErrorCode.INTERNAL, message: 'Activation failed' } };

    const exp = act.license.expiredAt!;
    return {
      state: 'success',
      username: act.username,
      license: act.license.licenseKey,
      activatedAt: act.license.activatedAt?.toISOString(),
      expiredAt: exp.toISOString(),
      remainingDays: Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86_400_000)),
    };
  }
}
