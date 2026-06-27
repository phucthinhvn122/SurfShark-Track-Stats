// apps/api/src/admin/queries.service.ts
import { Injectable } from '@nestjs/common';
import { LicenseStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

/** Read-only listings for the admin panel: keys, users, logs. */
@Injectable()
export class QueriesService {
  constructor(private readonly prisma: PrismaService) {}

  async keys(opts: { status?: string; search?: string; page?: number; limit?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, opts.limit ?? 20);
    const where: any = {};
    if (opts.status && opts.status !== 'all') where.status = opts.status as LicenseStatus;
    if (opts.search)
      where.OR = [
        { licenseKey: { contains: opts.search, mode: 'insensitive' } },
        { username: { contains: opts.search, mode: 'insensitive' } },
      ];

    const [rows, total] = await Promise.all([
      this.prisma.license.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.license.count({ where }),
    ]);
    return { success: true, data: { rows, total, page, limit } };
  }

  async users(opts: { page?: number; limit?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, opts.limit ?? 20);
    const [rows, total] = await Promise.all([
      this.prisma.activation.findMany({
        where: { result: 'success' },
        include: { license: { select: { licenseKey: true, status: true, expiredAt: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.activation.count({ where: { result: 'success' } }),
    ]);
    return {
      success: true,
      data: {
        rows: rows.map((a) => ({
          kind: a.deviceCode ? 'device' : 'license',
          deviceCode: a.deviceCode ?? null,
          licenseKey: a.license?.licenseKey ?? null,
          status: a.license?.status ?? null,
          expiredAt: a.license?.expiredAt ?? null,
          ip: a.ipAddress,
          country: a.country,
          device: a.device,
          activatedAt: a.createdAt,
        })),
        total,
        page,
        limit,
      },
    };
  }

  /** Export all licenses as a CSV string. */
  async exportCsv(): Promise<string> {
    const rows = await this.prisma.license.findMany({ orderBy: { createdAt: 'desc' } });
    const head = 'license_key,username,status,duration_days,created_at,activated_at,expired_at,notes';
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = rows
      .map((l) =>
        [
          l.licenseKey,
          l.username ?? '',
          l.status,
          l.durationDays,
          l.createdAt.toISOString(),
          l.activatedAt?.toISOString() ?? '',
          l.expiredAt?.toISOString() ?? '',
          l.notes ?? '',
        ]
          .map(esc)
          .join(','),
      )
      .join('\n');
    return `${head}\n${body}`;
  }

  /** Logs are surfaced from telegram_logs / audit_logs. type filters the source. */
  async logs(type: string) {
    if (type === 'telegram') {
      const rows = await this.prisma.telegramLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
      return { success: true, data: rows };
    }
    if (type === 'security' || type === 'system') {
      const rows = await this.prisma.auditLog.findMany({
        include: { admin: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return { success: true, data: rows };
    }
    // activation / error derived from activations table
    const rows = await this.prisma.activation.findMany({
      where: type === 'error' ? { result: 'failed' } : {},
      include: { license: { select: { licenseKey: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { success: true, data: rows };
  }
}
