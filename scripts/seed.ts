// scripts/seed.ts — create the first admin + a few demo keys
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
const DAY = 86_400_000;

async function main() {
  // admin
  const passwordHash = await argon2.hash(process.env.SEED_ADMIN_PASSWORD ?? 'admin123');
  await prisma.admin.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', passwordHash },
  });

  // settings singleton
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, botUsername: '@SurfsharkBot', durationDays: 30, rateLimitPerMin: 5 },
  });

  // demo keys
  await prisma.license.createMany({
    data: [
      { licenseKey: 'VPN-A9X2-K8LM', status: 'unused', durationDays: 30 },
      { licenseKey: 'VPN-7H3K-M2QP', status: 'unused', durationDays: 7 },
      { licenseKey: 'VPN-DEAD-BEEF', status: 'banned', durationDays: 30 },
    ],
    skipDuplicates: true,
  });

  console.log('Seed complete. Admin: admin / (SEED_ADMIN_PASSWORD or admin123)');
}

main().finally(() => prisma.$disconnect());
