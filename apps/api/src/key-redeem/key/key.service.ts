// apps/api/src/key-redeem/key/key.service.ts
//
// All DB access for license keys used by the key-redeem flow.
// Single responsibility: validate and (atomically) consume a license key.
import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AppException } from '../../common/app-exception';
import { ErrorCode, type RedeemResultCode } from '@surfshark/shared';

type License = {
  id: string;
  licenseKey: string;
  username: string | null;
  status: 'unused' | 'active' | 'expired' | 'banned';
  durationDays: number;
  notes: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  expiredAt: Date | null;
};

export interface KeyCheckResult {
  valid: boolean;
  code: RedeemResultCode;
  message: string;
  license: License | null;
  remainingUses?: number;
}

export interface RedeemReservationContext {
  requestId: string;
  deviceCode: string;
  ipAddress?: string;
  country?: string;
  device?: string;
}

@Injectable()
export class KeyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Look up a license key and check it against every business rule:
   *   - exists
   *   - not banned
   *   - not expired (auto-flip if its window has passed)
   *   - not currently in use
   *   - has remaining uses (if a max-uses limit is configured on the row)
   *
   * Returns a structured result — no exceptions on business-rule failures.
   * Throws only on infrastructure errors (DB down, etc.).
   */
  async checkKey(rawKey: string): Promise<KeyCheckResult> {
    const key = this.normalizeKey(rawKey);
    if (!key) {
      return this.invalid('Key is required');
    }

    const license = await this.prisma.license.findUnique({ where: { licenseKey: key } });
    if (!license) {
      return this.invalid('Key not found', 'invalid_key');
    }

    // Auto-flip active→expired if the time window has passed.
    const fresh = await this.refreshExpiry(license);

    if (fresh.status === 'banned') {
      return { valid: false, code: 'key_banned', message: 'Key has been banned', license: fresh };
    }
    if (fresh.status === 'expired') {
      return { valid: false, code: 'key_expired', message: 'Key has expired', license: fresh };
    }
    if (fresh.status === 'active') {
      return { valid: false, code: 'key_in_use', message: 'Key is already in use', license: fresh };
    }
    return { valid: true, code: 'success', message: 'OK', license: fresh };
  }

  /**
   * Atomically transition an `unused` license to `active` (or `expired` if its
   * duration is zero). Performed in a single transaction with a row lock so two
   * concurrent redeem attempts cannot both win.
   */
  async consume(licenseKey: string, requestId: string): Promise<License> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; duration_days: number }>>`
        SELECT id, status, duration_days FROM licenses
        WHERE license_key = ${licenseKey} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new AppException(ErrorCode.KEY_NOT_FOUND, 'Key not found', HttpStatus.NOT_FOUND);
      if (row.status !== 'unused') {
        throw new AppException(
          ErrorCode.KEY_IN_USE,
          `Key is not available (status=${row.status})`,
          HttpStatus.CONFLICT,
        );
      }
      const activatedAt = new Date();
      const expiredAt = row.duration_days === 0 ? activatedAt : new Date(activatedAt.getTime() + row.duration_days * 86_400_000);
      const status = row.duration_days === 0 ? 'expired' : 'active';
      return tx.license.update({
        where: { id: row.id },
        data: { status, activatedAt, expiredAt },
      });
    });
  }

  /** Persist a requestId → activation row so the admin "users" view shows it. */
  async reserveRedeem(licenseKey: string, ctx: RedeemReservationContext): Promise<License> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM licenses WHERE license_key = ${this.normalizeKey(licenseKey)} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new AppException(ErrorCode.KEY_NOT_FOUND, 'Key not found', HttpStatus.NOT_FOUND);

      const license = await tx.license.findUnique({ where: { id: row.id } });
      if (!license) throw new AppException(ErrorCode.KEY_NOT_FOUND, 'Key not found', HttpStatus.NOT_FOUND);

      let fresh = license;
      if (fresh.status === 'active' && fresh.expiredAt && fresh.expiredAt.getTime() <= Date.now()) {
        fresh = await tx.license.update({ where: { id: fresh.id }, data: { status: 'expired' } });
      }
      if (fresh.status === 'banned') throw new AppException(ErrorCode.KEY_BANNED, 'Key has been banned', HttpStatus.FORBIDDEN);
      if (fresh.status === 'expired') throw new AppException(ErrorCode.KEY_EXPIRED, 'Key has expired', HttpStatus.FORBIDDEN);
      if (fresh.status === 'active') throw new AppException(ErrorCode.KEY_IN_USE, 'Key is already in use', HttpStatus.CONFLICT);

      const pending = await tx.activation.findFirst({
        where: { licenseId: fresh.id, result: 'pending' },
        select: { id: true },
      });
      if (pending) throw new AppException(ErrorCode.KEY_IN_USE, 'Key redemption is already in progress', HttpStatus.CONFLICT);

      await tx.activation.create({
        data: {
          requestId: ctx.requestId,
          licenseId: fresh.id,
          deviceCode: ctx.deviceCode,
          ipAddress: ctx.ipAddress,
          country: ctx.country,
          device: ctx.device,
          result: 'pending',
        },
      });

      return fresh;
    });
  }

  async commitReservedRedeem(licenseKey: string, requestId: string): Promise<License> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; duration_days: number }>>`
        SELECT id, status, duration_days FROM licenses
        WHERE license_key = ${this.normalizeKey(licenseKey)} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new AppException(ErrorCode.KEY_NOT_FOUND, 'Key not found', HttpStatus.NOT_FOUND);
      if (row.status !== 'unused') {
        throw new AppException(
          ErrorCode.KEY_IN_USE,
          `Key is not available (status=${row.status})`,
          HttpStatus.CONFLICT,
        );
      }

      const activatedAt = new Date();
      const expiredAt = row.duration_days === 0 ? activatedAt : new Date(activatedAt.getTime() + row.duration_days * 86_400_000);
      const status = row.duration_days === 0 ? 'expired' : 'active';
      const updated = await tx.license.update({
        where: { id: row.id },
        data: { status, activatedAt, expiredAt },
      });

      const activation = await tx.activation.updateMany({
        where: { requestId, licenseId: row.id, result: 'pending' },
        data: { result: 'success' },
      });
      if (activation.count !== 1) {
        throw new AppException(ErrorCode.KEY_IN_USE, 'Redemption request is not pending', HttpStatus.CONFLICT);
      }

      return updated;
    });
  }

  async markRedeemFailed(requestId: string, reason: string): Promise<void> {
    await this.prisma.activation.updateMany({
      where: { requestId, result: 'pending' },
      data: {
        result: 'failed',
        sessionMeta: { redeemFailure: reason },
      },
    });
  }

  async recordActivation(licenseId: string, requestId: string, deviceCode: string, meta: { ip?: string; country?: string; ua?: string }): Promise<void> {
    await this.prisma.activation.create({
      data: {
        requestId,
        licenseId,
        deviceCode,
        ipAddress: meta.ip,
        country: meta.country,
        device: meta.ua,
        result: 'success',
      },
    });
  }

  private async refreshExpiry(license: License): Promise<License> {
    if (license.status === 'active' && license.expiredAt && license.expiredAt.getTime() <= Date.now()) {
      return this.prisma.license.update({ where: { id: license.id }, data: { status: 'expired' } });
    }
    return license;
  }

  private normalizeKey(raw: string): string {
    return (raw ?? '').trim().toUpperCase();
  }

  private invalid(message: string, code: RedeemResultCode = 'invalid_key'): KeyCheckResult {
    return { valid: false, code, message, license: null };
  }
}
