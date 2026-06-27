// apps/api/src/telegram/activation-queue.service.ts
import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS } from '../common/redis.module';

export interface ActivationJob {
  requestId: string;
  deviceCode: string;
  licenseKey: string;
}

/**
 * API-side PRODUCER only. Enqueues activation jobs for the Telegram worker.
 * jobId = requestId makes double-submits idempotent.
 * FIX (audit): reuses the shared Redis connection instead of opening its own.
 */
@Injectable()
export class ActivationQueueService implements OnModuleDestroy {
  readonly queue: Queue<ActivationJob>;

  constructor(@Inject(REDIS) connection: Redis) {
    this.queue = new Queue<ActivationJob>('activation', { connection });
  }

  async enqueue(job: ActivationJob) {
    await this.queue.add('activate', job, {
      jobId: job.requestId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: false, // kept for inspection / DLQ handling
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
