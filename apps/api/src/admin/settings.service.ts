// apps/api/src/admin/settings.service.ts
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { PrismaService } from '../common/prisma.service';

/** AES-256-GCM encryption for the Telegram session at rest. */
function key() {
  return scryptSync(process.env.SESSION_ENC_KEY!, 'surfshark-salt', 32);
}
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}
export function decrypt(payload: string): string {
  const [ivH, tagH, dataH] = payload.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataH, 'hex')), decipher.final()]).toString('utf8');
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns settings with the session MASKED (never expose the raw string). */
  async get() {
    const s = await this.prisma.settings.findFirst({ where: { id: 1 } });
    return {
      success: true,
      data: {
        botUsername: s?.botUsername ?? '@SurfsharkBot',
        durationDays: s?.durationDays ?? 30,
        rateLimitPerMin: s?.rateLimitPerMin ?? 5,
        telegramSession: s?.telegramSession ? '••••••••••••••••' : null,
        updatedAt: s?.updatedAt,
      },
    };
  }

  async update(patch: {
    telegramSession?: string;
    botUsername?: string;
    durationDays?: number;
    rateLimitPerMin?: number;
  }) {
    const data: any = { ...patch };
    if (patch.telegramSession) data.telegramSession = encrypt(patch.telegramSession);
    const s = await this.prisma.settings.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });
    return { success: true, data: { updatedAt: s.updatedAt } };
  }
}
