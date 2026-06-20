// apps/api/src/license/expiry.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LicenseService } from './license.service';

/**
 * FIX (audit): persists license expiry. Hourly sweep flips active keys whose
 * 30-day window has passed to `expired`, keeping the DB (and dashboard counts)
 * consistent with reality.
 */
@Injectable()
export class ExpiryCron {
  private readonly logger = new Logger('ExpiryCron');
  constructor(private readonly licenses: LicenseService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep() {
    const n = await this.licenses.markExpired();
    if (n > 0) this.logger.log(`Marked ${n} license(s) as expired`);
  }
}
