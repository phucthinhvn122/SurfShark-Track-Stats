// apps/api/src/license/license.service.ts
//
// Owns the License state machine and all direct DB access to the licenses table.
// Other modules depend on this service (not on PrismaService) so that:
//   - business rules live in one place
//   - DB calls are parameterised (no SQL injection vector)
//   - it is trivial to stub in tests
import { Injectable, HttpStatus } from '@nestjs/common';
import type { License } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AppException } from '../common/app-exception';
import { ErrorCode } from '@surfshark/shared';

const DAY_MS = 86_400_000;

export type ReservationContext = {
  requestId: string;
  deviceCode: string;
  ipAddress?: string;
  country?: string;
  device?: string;
  sessionMeta?: Record<string, unknown>;
};

@Injectable()
export class LicenseService {
  constructor(private readonly prisma: PrismaService) {}

  async findByKey(licenseKey: string): Promise<License | null> {
    return this.prisma.license.findUnique({ where: { licenseKey } });
  }

  /**
   * Re-evaluates the time-based status of a license and persists it if it has
   * already expired. Returns the (possibly updated) row.
   */
  async refreshExpiry(license: License): Promise<License> {
    if (
      license.status === 'active' &&
      license.expiredAt &&
      license.expiredAt.getTime() <= Date.now()
    ) {
      return this.prisma.license.update({
        where: { id: license.id },
        data: { status: 'expired' },
      });
    }
    return license;
  }

  /**
   * Throws AppException when the license is missing, banned, expired, or already
   * in use. Returns a usable license on success.
   */
  async assertActivatable(licenseKey: string): Promise<License> {
    const license = await this.findByKey(licenseKey);
    if (!license) {
      throw new AppException(ErrorCode.KEY_NOT_FOUND, 'License key not found', HttpStatus.NOT_FOUND);
    }
    const fresh = await this.refreshExpiry(license);
    if (fresh.status === 'banned') {
      throw new AppException(ErrorCode.KEY_BANNED, 'License key has been banned', HttpStatus.FORBIDDEN);
    }
    if (fresh.status === 'expired') {
      throw new AppException(ErrorCode.KEY_EXPIRED, 'License key has expired', HttpStatus.FORBIDDEN);
    }
    if (fresh.status === 'active') {
      throw new AppException(ErrorCode.KEY_IN_USE, 'License key already in use', HttpStatus.CONFLICT);
    }
    return fresh;
  }

  /**
   * Persists a pending activation row and links it to the license. The license
   * itself is not mutated here — the worker commits the final state.
   */
  async reserveActivation(licenseKey: string, ctx: ReservationContext): Promise<License> {
    const license = await this.assertActivatable(licenseKey);
    try {
      await this.prisma.activation.create({
        data: {
          requestId: ctx.requestId,
          licenseId: license.id,
          deviceCode: ctx.deviceCode,
          ipAddress: ctx.ipAddress,
          country: ctx.country,
          device: ctx.device,
          sessionMeta: ctx.sessionMeta as object | undefined,
        },
      });
    } catch (e) {
      // Same requestId twice → idempotent re-submit, surface as conflict.
      throw new AppException(
        ErrorCode.VALIDATION,
        'Activation already in progress for this request',
        HttpStatus.CONFLICT,
      );
    }
    return license;
  }

  /** Hourly cron: flip active keys whose 30-day window has passed to `expired`. */
  async markExpired(): Promise<number> {
    const now = new Date();
    const { count } = await this.prisma.license.updateMany({
      where: { status: 'active', expiredAt: { lte: now } },
      data: { status: 'expired' },
    });
    return count;
  }

  async bulkCreate(count: number, durationDays: number, notes?: string): Promise<string[]> {
    const keys: string[] = [];
    const data: Array<{ licenseKey: string; durationDays: number; notes?: string }> = [];
    for (let i = 0; i < count; i++) {
      const key = this.generateLicenseKey();
      keys.push(key);
      data.push({ licenseKey: key, durationDays, notes });
    }
    await this.prisma.license.createMany({ data, skipDuplicates: true });
    return keys;
  }

  async ban(licenseKey: string) {
    const license = await this.assertExists(licenseKey);
    return this.prisma.license.update({ where: { id: license.id }, data: { status: 'banned' } });
  }

  async unban(licenseKey: string) {
    const license = await this.assertExists(licenseKey);
    return this.prisma.license.update({ where: { id: license.id }, data: { status: 'unused' } });
  }

  async extend(licenseKey: string, days: number) {
    const license = await this.assertExists(licenseKey);
    const base = license.expiredAt && license.expiredAt > new Date() ? license.expiredAt : new Date();
    return this.prisma.license.update({
      where: { id: license.id },
      data: { expiredAt: new Date(base.getTime() + days * DAY_MS), status: 'active' },
    });
  }

  async remove(licenseKey: string) {
    const license = await this.assertExists(licenseKey);
    await this.prisma.license.delete({ where: { id: license.id } });
    return { licenseKey };
  }

  private async assertExists(licenseKey: string): Promise<License> {
    const license = await this.findByKey(licenseKey);
    if (!license) {
      throw new AppException(ErrorCode.KEY_NOT_FOUND, 'License key not found', HttpStatus.NOT_FOUND);
    }
    return license;
  }

  private generateLicenseKey(): string {
    const block = () =>
      Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 32)]).join('');
    return `VPN-${block()}-${block()}`;
  }
}
