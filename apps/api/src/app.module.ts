// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import type { Redis } from 'ioredis';
import { PrismaModule } from './common/prisma.module';
import { RedisModule, REDIS } from './common/redis.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ConfigModule } from './config/config.module';
import { ActivationModule } from './activation/activation.module';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';
import { KeyRedeemModule } from './key-redeem/key-redeem.module';

@Module({
  imports: [
    ConfigModule, // validates env on boot, exposes typed config via ENV token
    PrismaModule, // global single Prisma connection
    RedisModule, // global single Redis connection
    ScheduleModule.forRoot(), // enables @Cron (expiry sweep)
    // Structured JSON logging (pino); redacts auth headers.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        autoLogging: true,
      },
    }),
    // FIX (audit): distributed rate limiting backed by Redis so limits hold
    // across multiple Render instances (in-memory storage was per-instance).
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        throttlers: [{ ttl: 60_000, limit: 60 }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    ActivationModule,
    AdminModule,
    KeyRedeemModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter }, // uniform error envelope
  ],
})
export class AppModule {}
