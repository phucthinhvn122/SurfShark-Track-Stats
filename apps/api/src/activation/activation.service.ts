// apps/api/src/activation/activation.service.ts
import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { ActivationQueueService } from '../telegram/activation-queue.service';
import { StatusStore } from './status.store';
import { LicenseService } from '../license/license.service';
import { AppException } from '../common/app-exception';
import { ErrorCode, type DeviceLoginInput, type StatusResponse } from '@surfshark/shared';

const PENDING_TIMEOUT_MS = 120_000; // 2 minutes — SSE pushes the terminal
// result the moment the worker writes it, so a long poll ceiling is no longer
// needed. 2 minutes is enough to absorb a worst-case bot round-trip.

@Injectable()
export class ActivationService {
  private readonly logger = new Logger(ActivationService.name);

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
    this.logger.log(
      `[activation:${requestId}] start license=${maskKey(input.license)} deviceCode=${maskDeviceCode(input.deviceCode)} ip=${meta.ip ?? '-'}`,
    );
    await this.licenses.reserveActivation(input.license, {
      requestId,
      deviceCode: input.deviceCode,
      ipAddress: meta.ip,
      country: meta.country,
      device: meta.ua,
      sessionMeta,
    });

    try {
      await this.queue.enqueue({ requestId, deviceCode: input.deviceCode, licenseKey: input.license });
      this.logger.log(`[activation:${requestId}] enqueued job jobId=${requestId}`);
    } catch (e) {
      const message = (e as Error).message;
      this.logger.error(`[activation:${requestId}] enqueue failed jobId=${requestId} error="${message}"`);
      await this.licenses.failReservedActivation(requestId, message).catch((markError) => {
        this.logger.error(`[activation:${requestId}] failed to mark activation failed: ${(markError as Error).message}`);
      });
      await this.status
        .set(requestId, {
          state: 'server_error',
          error: {
            code: ErrorCode.INTERNAL,
            message: 'Activation could not be queued. Please start a new login request.',
          },
        })
        .catch((statusError) => {
          this.logger.warn(`[activation:${requestId}] could not write enqueue-failure status: ${(statusError as Error).message}`);
        });
      throw new AppException(
        ErrorCode.INTERNAL,
        'Activation could not be queued. Please start a new login request.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    await this.status.set(requestId, { state: 'pending' }).catch((e) => {
      this.logger.warn(`[activation:${requestId}] queued but could not write pending status: ${(e as Error).message}`);
    });

    this.logger.log(`[activation:${requestId}] returned pending to frontend`);
    return { requestId, state: 'pending' as const };
  }

  /** Polled by the frontend until the state is terminal. */
  async getStatus(requestId: string): Promise<StatusResponse> {
    const cached = await this.status.get(requestId);
    if (cached) {
      this.logger.log(`[activation:${requestId}] status from cache state=${cached.state}${cached.error?.code ? ` code=${cached.error.code}` : ''}`);
      return cached;
    }

    const act = await this.prisma.activation.findUnique({
      where: { requestId },
      select: {
        deviceCode: true,
        result: true,
        createdAt: true,
        sessionMeta: true,
        license: { select: { licenseKey: true, durationDays: true, activatedAt: true, expiredAt: true } },
      },
    });
    if (!act) {
      this.logger.warn(`[activation:${requestId}] status not found (no cache, no DB row)`);
      throw new AppException(ErrorCode.KEY_NOT_FOUND, 'Request not found', HttpStatus.NOT_FOUND);
    }

    this.logger.log(`[activation:${requestId}] status from DB result=${act.result}`);

    if (act.result === 'pending') {
      // Check for timeout — if pending for too long, the worker likely never picked up the job.
      const ageMs = Date.now() - act.createdAt.getTime();
      if (ageMs > PENDING_TIMEOUT_MS) {
        this.logger.warn(`[activation:${requestId}] pending timed out ageMs=${ageMs}`);
        return {
          state: 'timeout',
          error: {
            code: ErrorCode.ACTIVATION_TIMEOUT,
            message: 'Login confirmation timed out. Please start a new login request.',
          },
        };
      }
      return { state: 'pending' };
    }

    if (act.result === 'failed') {
      const meta = act.sessionMeta as { error?: { code: string; message: string }; enqueueFailure?: string } | null;
      const code = meta?.error?.code;
      const message = meta?.error?.message ?? 'Activation failed. Please start a new login request.';

      if (code === ErrorCode.ACTIVATION_EXPIRED || code === 'ERR_BOT_EXPIRED') {
        return { state: 'activation_expired', error: { code: code ?? ErrorCode.ACTIVATION_EXPIRED, message } };
      }
      if (code === ErrorCode.ACTIVATION_TIMEOUT) {
        return { state: 'timeout', error: { code: ErrorCode.ACTIVATION_TIMEOUT, message } };
      }
      if (code === 'ERR_BOT_INVALID' || code === 'ERR_BOT_FAILED' || code === 'ERR_BOT_BANNED') {
        return { state: 'invalid_code', error: { code, message } };
      }
      if (code === ErrorCode.TELEGRAM_UNAVAILABLE) {
        return { state: 'telegram_unavailable', error: { code, message } };
      }
      if (code === ErrorCode.TELEGRAM_TIMEOUT) {
        return { state: 'timeout', error: { code: ErrorCode.ACTIVATION_TIMEOUT, message } };
      }

      return {
        state: 'server_error',
        error: {
          code: code ?? ErrorCode.INTERNAL,
          message,
        },
      };
    }

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

function maskKey(k: string, visible = 4): string {
  if (k.length <= visible * 2) return '*'.repeat(k.length);
  return `${k.slice(0, visible)}${'*'.repeat(k.length - visible * 2)}${k.slice(-visible)}`;
}

function maskDeviceCode(c: string): string {
  if (c.length <= 4) return '*'.repeat(c.length);
  return `${c.slice(0, 2)}${'*'.repeat(c.length - 4)}${c.slice(-2)}`;
}
