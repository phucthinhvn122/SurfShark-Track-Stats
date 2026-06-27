// apps/api/src/key-redeem/key-redeem.module.ts
import { Module } from '@nestjs/common';
import { KeyRedeemController } from './key-redeem.controller';
import { KeyRedeemService } from './key-redeem.service';
import { KeyService } from './key/key.service';
import { DeviceService } from './device/device.service';
import { TelegramModule } from './telegram/telegram.module';
import { GramJsTelegramService } from './telegram/gramjs-telegram.service';

@Module({
  imports: [TelegramModule],
  controllers: [KeyRedeemController],
  providers: [KeyRedeemService, KeyService, DeviceService, GramJsTelegramService],
})
export class KeyRedeemModule {}
