// apps/api/src/license/license.module.ts
import { Module } from '@nestjs/common';
import { LicenseService } from './license.service';
import { ExpiryCron } from './expiry.cron';

/** Provides the license state machine + the hourly expiry sweep. */
@Module({
  providers: [LicenseService, ExpiryCron],
  exports: [LicenseService],
})
export class LicenseModule {}
