// apps/api/src/activation/status.store.ts
import { Injectable, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../common/redis.module';
import type { StatusResponse } from '@surfshark/shared';

/**
 * Status cache so GET /status never touches Telegram. The worker writes the
 * terminal result here; the API reads it.
 * FIX (audit): uses the shared Redis connection instead of its own instance.
 */
@Injectable()
export class StatusStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(id: string) {
    return `status:${id}`;
  }

  async set(requestId: string, status: StatusResponse, ttlSeconds = 3600) {
    await this.redis.set(this.key(requestId), JSON.stringify(status), 'EX', ttlSeconds);
  }

  async get(requestId: string): Promise<StatusResponse | null> {
    const raw = await this.redis.get(this.key(requestId));
    return raw ? (JSON.parse(raw) as StatusResponse) : null;
  }
}
