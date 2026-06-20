// apps/api/src/admin/admin.service.ts
import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import type { Redis } from 'ioredis';
import { PrismaService } from '../common/prisma.service';
import { REDIS } from '../common/redis.module';
import { LicenseService } from '../license/license.service';
import { AppException } from '../common/app-exception';
import { ErrorCode } from '@surfshark/shared';

const MAX_FAILS = 10;
const LOCK_TTL = 15 * 60; // seconds
const JWT_ISS = 'surfshark-activation';
const JWT_AUD = 'surfshark-admin';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly licenses: LicenseService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private failKey(username: string) {
    return `login:fail:${username}`;
  }

  /**
   * FIX (audit): per-account lockout (in addition to per-IP throttling) to stop
   * credential stuffing spread across many IPs. Counter lives in Redis so it is
   * shared across API instances.
   */
  async login(username: string, password: string, ip?: string) {
    const fails = Number((await this.redis.get(this.failKey(username))) ?? 0);
    if (fails >= MAX_FAILS) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Account temporarily locked. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const admin = await this.prisma.admin.findUnique({ where: { username } });
    const ok = admin && (await argon2.verify(admin.passwordHash, password));
    if (!ok) {
      const n = await this.redis.incr(this.failKey(username));
      if (n === 1) await this.redis.expire(this.failKey(username), LOCK_TTL);
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    await this.redis.del(this.failKey(username)); // reset on success
    await this.audit(admin.id, 'login', undefined, ip);
    const accessToken = await this.jwt.signAsync(
      { sub: admin.id, username },
      { expiresIn: '8h', issuer: JWT_ISS, audience: JWT_AUD },
    );
    return { accessToken, expiresIn: 28_800 };
  }

  async dashboard() {
    // ensure expired keys are reflected before counting
    await this.licenses.markExpired();
    const [total, active, unused, expired, banned, totalActivations, todayActivations, failed] =
      await Promise.all([
        this.prisma.license.count(),
        this.prisma.license.count({ where: { status: 'active' } }),
        this.prisma.license.count({ where: { status: 'unused' } }),
        this.prisma.license.count({ where: { status: 'expired' } }),
        this.prisma.license.count({ where: { status: 'banned' } }),
        this.prisma.activation.count({ where: { result: 'success' } }),
        this.prisma.activation.count({ where: { result: 'success', createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
        this.prisma.activation.count({ where: { result: 'failed' } }),
      ]);
    return { success: true, data: { total, active, unused, expired, banned, totalActivations, todayActivations, failed } };
  }

  async bulkCreate(count: number, notes: string | undefined, adminId: string, ip?: string) {
    const keys = await this.licenses.bulkCreate(count, notes);
    await this.audit(adminId, 'bulk_create', `${count} keys`, ip);
    return { success: true, data: { generated: keys.length, keys } };
  }

  async ban(key: string, adminId: string, ip?: string) {
    const r = await this.licenses.ban(key);
    await this.audit(adminId, 'ban', key, ip);
    return { success: true, data: r };
  }
  async unban(key: string, adminId: string, ip?: string) {
    const r = await this.licenses.unban(key);
    await this.audit(adminId, 'unban', key, ip);
    return { success: true, data: r };
  }
  async extend(key: string, days: number, adminId: string, ip?: string) {
    const r = await this.licenses.extend(key, days);
    await this.audit(adminId, 'extend', `${key} +${days}d`, ip);
    return { success: true, data: r };
  }
  async remove(key: string, adminId: string, ip?: string) {
    const r = await this.licenses.remove(key);
    await this.audit(adminId, 'delete', key, ip);
    return { success: true, data: r };
  }

  private audit(adminId: string, action: string, target?: string, ipAddress?: string) {
    return this.prisma.auditLog.create({ data: { adminId, action, target, ipAddress } });
  }
}
