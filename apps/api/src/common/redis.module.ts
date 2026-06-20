// apps/api/src/common/redis.module.ts
import { Global, Module } from '@nestjs/common';
import IORedis, { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

/**
 * Single shared ioredis connection.
 * FIX (audit): replaces 3 separate `new IORedis()` instances in the API.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (): Redis =>
        new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null, lazyConnect: false }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
