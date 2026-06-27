// apps/api/src/admin/settings.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { encryptString } from '../common/crypto.util';
import type { SettingsUpdateInput } from '@surfshark/shared';

const SETTINGS_ID = 1;
const MASKED_SESSION_PLACEHOLDER = '••••••••••••••••';
const DEFAULT_BOT = '@Vpnssfree_bot';
const DEFAULT_DURATION_DAYS = 30;
const DEFAULT_RATE_LIMIT = 5;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns settings with the session MASKED (never expose the raw string). */
  async get() {
    const s = await this.prisma.settings.findFirst({ where: { id: SETTINGS_ID } });
    return {
      success: true,
      data: {
        botUsername: s?.botUsername ?? DEFAULT_BOT,
        durationDays: s?.durationDays ?? DEFAULT_DURATION_DAYS,
        rateLimitPerMin: s?.rateLimitPerMin ?? DEFAULT_RATE_LIMIT,
        telegramSession: s?.telegramSession ? MASKED_SESSION_PLACEHOLDER : null,
        updatedAt: s?.updatedAt,
      },
    };
  }

  async update(patch: SettingsUpdateInput) {
    const data: Record<string, unknown> = { ...patch };
    if (patch.telegramSession) data.telegramSession = encryptString(patch.telegramSession);
    const s = await this.prisma.settings.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: { id: SETTINGS_ID, ...data },
    });
    return { success: true, data: { updatedAt: s.updatedAt } };
  }
}
