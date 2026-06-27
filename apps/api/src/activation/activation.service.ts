// apps/api/src/activation/activation.service.ts
import { Injectable, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { ActivationQueueService } from '../telegram/activation-queue.service';
import { StatusStore } from './status.store';
import { AppException } from '../common/app-exception';
import { ErrorCode, type DeviceLoginInput, type StatusResponse } from '@surfshark/shared';

@Injectable()
export class ActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ActivationQueueService,
    private readonly status: StatusStore,
  ) {}

  /**
   * Persist a pending device-code login and enqueue a Telegram job.
   * Returns fast (HTTP < 500ms); the worker writes the terminal result.
   */
  async activate(input: DeviceLoginInput, meta: { ip?: string; ua?: string; country?: string }) {
    const requestId = `req_${randomUUID()}`;
    await this.prisma.activation.create({
      data: {
        requestId,
        deviceCode: input.deviceCode,
        licenseId: null,
        username: null,
        ipAddress: meta.ip,
        country: meta.country,
        device: meta.ua,
        sessionMeta: { ip: meta.ip, country: meta.country, ua: meta.ua },
        result: 'pending',
      },
    });

    await this.status.set(requestId, { state: 'processing' });
    await this.queue.enqueue({ requestId, deviceCode: input.deviceCode });

    return { requestId, state: 'processing' as const };
  }

  /** Polled by the frontend until the state is terminal. */
  async getStatus(requestId: string): Promise<StatusResponse> {
    const cached = await this.status.get(requestId);
    if (cached) return cached;

    // fallback to DB if cache expired
    const act = await this.prisma.activation.findUnique({
      where: { requestId },
      select: { deviceCode: true, result: true, createdAt: true },
    });
    if (!act) throw new AppException(ErrorCode.KEY_NOT_FOUND, 'Request not found', HttpStatus.NOT_FOUND);

    if (act.result === 'pending') return { state: 'processing' };
    if (act.result === 'failed')
      return { state: 'failed', error: { code: ErrorCode.INTERNAL, message: 'Login failed' } };

    return {
      state: 'success',
      deviceCode: act.deviceCode ?? undefined,
      activatedAt: act.createdAt.toISOString(),
    };
  }
}
