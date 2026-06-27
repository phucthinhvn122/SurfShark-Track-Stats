// apps/api/src/activation/activation.service.ts
import { Injectable, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { ActivationQueueService } from '../telegram/activation-queue.service';
import { StatusStore } from './status.store';
import { LicenseService } from '../license/license.service';
import { AppException } from '../common/app-exception';
import { ErrorCode, type DeviceLoginInput, type StatusResponse } from '@surfshark/shared';

@Injectable()
export class ActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly licenses: LicenseService,
    private readonly queue: ActivationQueueService,
    private readonly status: StatusStore,
  ) {}

  /**
   * Persist a pending device-code login and enqueue a Telegram job.
   * Returns fast (HTTP < 500ms); the worker writes the terminal result.
   */
  async activate(input: DeviceLoginInput, meta: { ip?: string; ua?: string; country?: string }) {
    const requestId = `req_${randomUUID()}`;
    const sessionMeta = Object.fromEntries(
      Object.entries({ ip: meta.ip, country: meta.country, ua: meta.ua }).filter(([, v]) => v != null),
    );
    await this.licenses.reserveActivation(input.license, {
      requestId,
      deviceCode: input.deviceCode,
      ipAddress: meta.ip,
      country: meta.country,
      device: meta.ua,
      sessionMeta,
    });

    await this.status.set(requestId, { state: 'processing' });
    await this.queue.enqueue({ requestId, deviceCode: input.deviceCode, licenseKey: input.license });

    return { requestId, state: 'processing' as const };
  }

  /** Polled by the frontend until the state is terminal. */
  async getStatus(requestId: string): Promise<StatusResponse> {
    const cached = await this.status.get(requestId);
    if (cached) return cached;

    // fallback to DB if cache expired
    const act = await this.prisma.activation.findUnique({
      where: { requestId },
      select: {
        deviceCode: true,
        result: true,
        createdAt: true,
        license: { select: { licenseKey: true, durationDays: true, activatedAt: true, expiredAt: true } },
      },
    });
    if (!act) throw new AppException(ErrorCode.KEY_NOT_FOUND, 'Request not found', HttpStatus.NOT_FOUND);

    if (act.result === 'pending') return { state: 'processing' };
    if (act.result === 'failed')
      return { state: 'failed', error: { code: ErrorCode.INTERNAL, message: 'Login failed' } };

    return {
      state: 'success',
      deviceCode: act.deviceCode ?? undefined,
      licenseKey: act.license?.licenseKey,
      durationDays: act.license?.durationDays,
      activatedAt: act.license?.activatedAt?.toISOString() ?? act.createdAt.toISOString(),
      expiredAt: act.license?.expiredAt?.toISOString(),
    };
  }
}
