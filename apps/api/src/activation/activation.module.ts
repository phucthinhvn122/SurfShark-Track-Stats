// apps/api/src/activation/activation.module.ts
import { Module } from '@nestjs/common';
import { ActivationController } from './activation.controller';
import { ActivationService } from './activation.service';
import { StatusStore } from './status.store';
import { LicenseModule } from '../license/license.module';
import { ActivationQueueService } from '../telegram/activation-queue.service';

@Module({
  imports: [LicenseModule],
  controllers: [ActivationController],
  providers: [ActivationService, StatusStore, ActivationQueueService],
})
export class ActivationModule {}
