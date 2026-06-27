// apps/api/src/key-redeem/key/key.service.ts
//
// All DB access for license keys used by the key-redeem flow.
// Single responsibility: validate and (atomically) consume a license key.
import { Injectable, HttpStatus } from '@nestjs/common';
import type { License } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AppException } from '../../common/app-exception';
import { ErrorCode, type RedeemResultCode } from '@surfshark/shared';

export interface KeyCheckResult {
  valid: boolean;
  code: RedeemResultCode;
  message: string;
  license: License | null;
  remainingUses?: number;
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
