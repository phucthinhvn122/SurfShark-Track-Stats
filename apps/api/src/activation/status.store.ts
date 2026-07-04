// apps/api/src/activation/status.store.ts
import { Injectable, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../common/redis.module';
import type { StatusResponse } from '@surfshark/shared';

/**
 * Status cache so GET /status never touches Telegram. The worker writes the
 * terminal result here; the API reads it.
 * FIX (audit): uses the shared Redis connection instead of its own instance.
 * FIX (speed): on every write, also PUBLISHes to `status:events` so the SSE
 * endpoint can push the new status to the browser instantly (no polling lag).
 */
@Injectable()
export class StatusStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(id: string) {
    return `status:${id}`;
  }

  private channel() {
    return 'status:events';
  }

  async set(requestId: string, status: StatusResponse, ttlSeconds = 3600) {
    const payload = JSON.stringify(status);
    // Pipeline so the SET and PUBLISH are sent in one round-trip.
    await this.redis
      .multi()
      .set(this.key(requestId), payload, 'EX', ttlSeconds)
      .publish(this.channel(), JSON.stringify({ requestId, status }))
      .exec();
  }

  async get(requestId: string): Promise<StatusResponse | null> {
    const raw = await this.redis.get(this.key(requestId));
    return raw ? (JSON.parse(raw) as StatusResponse) : null;
  }
}
