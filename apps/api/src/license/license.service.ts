// apps/api/src/license/license.service.ts
import { Injectable, HttpStatus } from '@nestjs/common';
import { randomInt } from 'crypto';
import { License } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AppException } from '../common/app-exception';
import { ErrorCode } from '@surfshark/shared';

const DAY = 86_400_000;

/**
 * Pure license state machine + persistence.
 * Reused by ActivationService, AdminService and the worker callback.
 */
@Injectable()
export class LicenseService {
  constructor(private readonly prisma: PrismaService) {}

  /** Roll any active-but-past-expiry keys to `expired` (lazy view-only). */
  private withExpiry(l: License): License {
    if (l.status === 'active' && l.expiredAt && l.expiredAt.getTime() < Date.now()) {
      return { ...l, status: 'expired' };
    }
    return l;
  }

  async findByKey(licenseKey: string): Promise<License | null> {
    const l = await this.prisma.license.findUnique({ where: { licenseKey } });
    return l ? this.withExpiry(l) : null;
  }

  /**
   * Validate a key for activation by `username`. Throws AppException on any
   * invalid state. Returns the (fresh) license if it MAY be activated.
   */
  async assertActivatable(licenseKey: string, username: string): Promise<License> {
    const l = await this.findByKey(licenseKey);
    if (!l) throw new AppException(ErrorCode.KEY_NOT_FOUND, 'License not found', HttpStatus.NOT_FOUND);
    if (l.status === 'banned')
      throw new AppException(ErrorCode.KEY_BANNED, 'This key has been banned', HttpStatus.FORBIDDEN);
    if (l.status === 'expired')
      throw new AppException(ErrorCode.KEY_EXPIRED, 'This key has expired', HttpStatus.GONE);
    if (l.status === 'active' && l.username && l.username !== username)
      throw new AppException(ErrorCode.KEY_IN_USE, `Key already bound to "${l.username}"`, HttpStatus.CONFLICT);
    return l;
  }

  /**
   * Commit a successful activation atomically.
   * FIX (audit): wraps the read-then-write in a transaction with a row-level
   * lock (`SELECT … FOR UPDATE`) so two concurrent activations for the same
   * unused key cannot both bind it. The loser re-validates against the now
   * active key and is rejected if bound to a different user.
   */
  async commitActivation(licenseKey: string, username: string, durationDays = 30): Promise<License> {
    return this.prisma.$transaction(async (tx) => {
      // lock the row for the duration of the transaction
      const locked = await tx.$queryRaw<Array<{ id: string; status: string; username: string | null }>>`
        SELECT id, status, username FROM licenses WHERE license_key = ${licenseKey} FOR UPDATE`;
      const row = locked[0];
      if (!row) throw new AppException(ErrorCode.KEY_NOT_FOUND, 'License not found', HttpStatus.NOT_FOUND);
      if (row.status === 'banned')
        throw new AppException(ErrorCode.KEY_BANNED, 'This key has been banned', HttpStatus.FORBIDDEN);
      if (row.status === 'active' && row.username && row.username !== username)
        throw new AppException(ErrorCode.KEY_IN_USE, `Key already bound to "${row.username}"`, HttpStatus.CONFLICT);

      if (row.status === 'unused') {
        const activatedAt = new Date();
        const expiredAt = new Date(activatedAt.getTime() + durationDays * DAY);
        return tx.license.update({
          where: { licenseKey },
          data: { username, status: 'active', activatedAt, expiredAt },
        });
      }
      // already active for this same user → no-op, return current
      return tx.license.findUniqueOrThrow({ where: { licenseKey } });
    });
  }

  /**
   * Persist expiry: flip active keys whose window has passed to `expired`.
   * FIX (audit): previously expiry was computed in memory only, so the DB kept
   * stale `active` rows and dashboard counts were wrong. Run on a schedule.
   */
  async markExpired(): Promise<number> {
    const res = await this.prisma.license.updateMany({
      where: { status: 'active', expiredAt: { lt: new Date() } },
      data: { status: 'expired' },
    });
    return res.count;
  }

  // ----- admin operations -----
  ban(licenseKey: string) {
    return this.prisma.license.update({ where: { licenseKey }, data: { status: 'banned', username: null } });
  }

  async unban(licenseKey: string) {
    const l = await this.prisma.license.findUniqueOrThrow({ where: { licenseKey } });
    return this.prisma.license.update({
      where: { licenseKey },
      data: { status: l.activatedAt ? 'active' : 'unused' },
    });
  }

  async extend(licenseKey: string, days = 30) {
    const l = await this.prisma.license.findUniqueOrThrow({ where: { licenseKey } });
    if (!l.expiredAt)
      throw new AppException(ErrorCode.VALIDATION, 'Key not activated yet', HttpStatus.BAD_REQUEST);
    const base = Math.max(l.expiredAt.getTime(), Date.now());
    return this.prisma.license.update({
      where: { licenseKey },
      data: { expiredAt: new Date(base + days * DAY), status: 'active' },
    });
  }

  async remove(licenseKey: string) {
    await this.prisma.license.delete({ where: { licenseKey } });
    return { deleted: true };
  }

  /** Bulk-generate collision-free keys VPN-XXXX-XXXX. */
  async bulkCreate(count: number, notes?: string) {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rnd = (n: number) =>
      Array.from({ length: n }, () => charset[randomInt(0, charset.length)]).join('');
    // FIX (audit): crypto-random keys (Math.random was predictable) and no
    // full-table preload — rely on the unique constraint + skipDuplicates and
    // top up until the requested count is inserted. OOM-safe at scale (was
    // loading every license_key into memory for a collision check).
    const inserted = new Set<string>();
    let attempts = 0;
    while (inserted.size < count && attempts < count * 10 + 50) {
      const batch: string[] = [];
      for (let i = inserted.size; i < count; i++) batch.push(`VPN-${rnd(4)}-${rnd(4)}`);
      await this.prisma.license.createMany({
        data: batch.map((licenseKey) => ({ licenseKey, notes })),
        skipDuplicates: true,
      });
      const known = await this.prisma.license.findMany({
        where: { licenseKey: { in: batch } },
        select: { licenseKey: true },
      });
      for (const k of known) inserted.add(k.licenseKey);
      attempts++;
    }
    return [...inserted];
  }
}
