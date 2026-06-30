// scripts/repair-bot-success-activations.ts
//
// Repairs historical activations that were marked failed because an older
// worker did not recognise a successful bot reply.
//
// Default mode is dry-run. Pass --write to update the activation and consume
// the linked license.
import { PrismaClient, type Prisma, type TelegramLog } from '@prisma/client';

declare const process: {
  argv: string[];
  exit(code?: number): never;
};

const DAY_MS = 86_400_000;

type Candidate = Prisma.ActivationGetPayload<{
  include: {
    license: {
      select: {
        id: true;
        licenseKey: true;
        status: true;
        durationDays: true;
      };
    };
  };
}>;

type RepairOutcome =
  | { status: 'repaired'; licenseKey: string; expiresAt: Date | null }
  | { status: 'skipped'; reason: string };

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function usage() {
  console.log(`Usage:
  pnpm tsx scripts/repair-bot-success-activations.ts [options]

Options:
  --write                 Apply repairs. Omit for dry-run.
  --limit <n>             Failed activations to inspect. Default: 200.
  --window-minutes <n>    Match Telegram replies within this window around the activation. Default: 120.

Examples:
  pnpm tsx scripts/repair-bot-success-activations.ts
  pnpm tsx scripts/repair-bot-success-activations.ts --limit 50
  pnpm tsx scripts/repair-bot-success-activations.ts --write
`);
}

function searchableText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // \u0111/\u0110 is a standalone letter (not a combining diacritic) \u2014 fold to "d".
    .replace(/[\u0111\u0110]/g, 'd')
    .toLowerCase();
}

function isSuccessReply(value: string | null): boolean {
  const raw = value ?? '';
  const text = searchableText(raw);

  if (/\bthat\s*bai\b|khong\s*thanh\s*cong/.test(text)) return false;
  if (/\bthanh\s*cong\b|dang\s*nhap\s*thanh\s*cong/.test(text)) return true;
  return /\u2705|activated|logged in|success|valid|welcome/i.test(raw);
}

function maskDeviceCode(code: string): string {
  if (code.length <= 4) return '*'.repeat(code.length);
  return `${code.slice(0, 2)}${'*'.repeat(code.length - 4)}${code.slice(-2)}`;
}

async function findMatchingSuccessLog(
  prisma: PrismaClient,
  activation: Candidate,
  windowMs: number,
): Promise<TelegramLog | null> {
  const deviceCode = activation.deviceCode;
  if (!deviceCode) return null;

  const maskedCommand = `/login ${maskDeviceCode(deviceCode)}`;
  const from = new Date(activation.createdAt.getTime() - windowMs);
  const to = new Date(activation.createdAt.getTime() + windowMs);

  const logs = await prisma.telegramLog.findMany({
    where: {
      action: 'login',
      status: 'received',
      createdAt: { gte: from, lte: to },
      OR: [
        { request: maskedCommand },
        { response: { contains: deviceCode, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  return (
    logs.find((log) => {
      const response = log.response ?? '';
      return (
        isSuccessReply(response) &&
        (log.request === maskedCommand ||
          response.toUpperCase().includes(deviceCode.toUpperCase()))
      );
    }) ?? null
  );
}

async function repairActivation(prisma: PrismaClient, activation: Candidate): Promise<RepairOutcome> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.activation.findUnique({
      where: { id: activation.id },
      select: { id: true, licenseId: true, result: true, createdAt: true },
    });
    if (!current) return { status: 'skipped', reason: 'activation no longer exists' };
    if (current.result !== 'failed') return { status: 'skipped', reason: `activation is now ${current.result}` };
    if (!current.licenseId) return { status: 'skipped', reason: 'activation has no linked license' };

    const rows = await tx.$queryRaw<
      Array<{ id: string; license_key: string; status: string; duration_days: number }>
    >`SELECT id, license_key, status, duration_days FROM licenses WHERE id = ${current.licenseId} FOR UPDATE`;
    const license = rows[0];
    if (!license) return { status: 'skipped', reason: 'linked license no longer exists' };
    if (license.status !== 'unused') {
      return { status: 'skipped', reason: `license is ${license.status}` };
    }

    const activatedAt = current.createdAt;
    const expiresAt =
      license.duration_days === 0
        ? activatedAt
        : new Date(activatedAt.getTime() + license.duration_days * DAY_MS);
    const status = license.duration_days === 0 ? 'expired' : 'active';

    await tx.license.update({
      where: { id: license.id },
      data: { status, activatedAt, expiredAt: expiresAt },
    });
    await tx.activation.update({
      where: { id: current.id },
      data: { result: 'success' },
    });

    return { status: 'repaired', licenseKey: license.license_key, expiresAt };
  });
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    usage();
    return;
  }

  const write = hasFlag('--write');
  const limit = Number(argValue('--limit') ?? 200);
  const windowMinutes = Number(argValue('--window-minutes') ?? 120);
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit must be a positive integer');
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    throw new Error('--window-minutes must be a positive number');
  }

  const prisma = new PrismaClient();
  const windowMs = windowMinutes * 60_000;
  let matched = 0;
  let repaired = 0;
  let skipped = 0;

  try {
    const activations = await prisma.activation.findMany({
      where: {
        result: 'failed',
        deviceCode: { not: null },
        licenseId: { not: null },
      },
      include: {
        license: {
          select: {
            id: true,
            licenseKey: true,
            status: true,
            durationDays: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    console.log(
      `${write ? 'WRITE' : 'DRY-RUN'}: inspecting ${activations.length} failed activation(s)`,
    );

    for (const activation of activations) {
      const log = await findMatchingSuccessLog(prisma, activation, windowMs);
      if (!log) continue;
      matched++;

      const label = `${activation.requestId} code=${activation.deviceCode} key=${
        activation.license?.licenseKey ?? '?'
      }`;
      if (!write) {
        console.log(`would repair ${label} log=${log.id}`);
        continue;
      }

      const outcome = await repairActivation(prisma, activation);
      if (outcome.status === 'repaired') {
        repaired++;
        console.log(`repaired ${label} expires=${outcome.expiresAt?.toISOString() ?? 'never'}`);
      } else {
        skipped++;
        console.log(`skipped ${label}: ${outcome.reason}`);
      }
    }

    console.log(
      `summary inspected=${activations.length} matched=${matched} repaired=${repaired} skipped=${skipped}`,
    );
    if (!write && matched > 0) {
      console.log('Run again with --write to apply these repairs.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
