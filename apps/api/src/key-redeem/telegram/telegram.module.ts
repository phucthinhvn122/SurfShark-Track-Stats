// apps/api/src/key-redeem/telegram/telegram.module.ts
import { Module } from '@nestjs/common';
import { GramJsTelegramService } from './gramjs-telegram.service';

@Module({
  providers: [GramJsTelegramService],
  exports: [GramJsTelegramService],
})
export class TelegramModule {}
