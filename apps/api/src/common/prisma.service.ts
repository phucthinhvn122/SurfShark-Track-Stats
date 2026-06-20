// apps/api/src/common/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma connection for the whole API process.
 * FIX (audit): replaces 6 separate `new PrismaClient()` instances that each
 * opened their own pool → connection exhaustion on the Supabase pooler.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Drain connections cleanly on SIGTERM (Render redeploys). */
  enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
