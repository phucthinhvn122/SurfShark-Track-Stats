// apps/api/src/key-redeem/key-redeem.service.ts
//
// Orchestrates the three steps the spec asks for:
//   1. validate the key in the DB
//   2. read the device code from the Surfshark app
//   3. send the command via the user-account Telegram client
//
// All inputs are sanitised in the controller (Zod pipe). The orchestrator never
// throws on expected business outcomes — it always returns a structured
// RedeemResult so the UI can render the appropriate message.
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { RedeemResult, RedeemKeyInput } from '@surfshark/shared';
import { KeyService } from './key/key.service';
import { DeviceService } from './device/device.service';
import { GramJsTelegramService } from './telegram/gramjs-telegram.service';
import { maskDeviceCode, maskKey } from '../common/masking.util';

export interface RedeemMeta {
  ip?: string;
  ua?: string;
  country?: string;
}

@Injectable()
export class KeyRedeemService {
  private readonly logger = new Logger('KeyRedeemService');

  constructor(
    private readonly keys: KeyService,
    private readonly devices: DeviceService,
    private readonly telegram: GramJsTelegramService,
  ) {}

  async redeem(input: RedeemKeyInput, meta: RedeemMeta): Promise<RedeemResult> {
    const requestId = `redeem_${randomUUID()}`;
    const maskedKey = maskKey(input.key);
    this.logger.log(`redeem start key=${maskedKey} ip=${meta.ip ?? '?'}`);

    // 1. Validate the key in the database.
    const keyCheck = await this.keys.checkKey(input.key);
    if (!keyCheck.valid || !keyCheck.license) {
      this.logger.warn(`redeem rejected key=${maskedKey} reason=${keyCheck.code}`);
      return { success: false, code: keyCheck.code, message: keyCheck.message };
    }
    const license = keyCheck.license;

    // 2. Pull the current device code from the Surfshark app.
    let deviceCode: string;
    try {
      deviceCode = await this.devices.getDeviceCode();
    } catch (e) {
      this.logger.error(`redeem device-code error key=${maskedKey}: ${(e as Error).message}`);
      return { success: false, code: 'device_code_unavailable', message: (e as Error).message };
    }

    // 3. Send the command and await the bot reply.
    const tg = await this.telegram.sendLoginCommand({ deviceCode });
    if (!tg.ok) {
      this.logger.warn(`redeem tg-failed key=${maskedKey} code=${tg.code} attempts=${tg.attempts}`);
      return {
        success: false,
        code: tg.code,
        message: tg.message,
        deviceCode: maskDeviceCode(deviceCode),
      };
    }

    // 4. Commit: flip the license to `active` and persist the activation row.
    try {
      const updated = await this.keys.consume(license.licenseKey, requestId);
      await this.keys.recordActivation(updated.id, requestId, deviceCode, meta);
      this.logger.log(`redeem success key=${maskedKey} licenseId=${updated.id}`);
      return {
        success: true,
        code: 'success',
        message: 'Login successful',
        deviceCode: maskDeviceCode(deviceCode),
        durationDays: updated.durationDays,
        expiredAt: updated.expiredAt?.toISOString(),
      };
    } catch (e) {
      this.logger.error(`redeem commit failed key=${maskedKey}: ${(e as Error).message}`);
      return { success: false, code: 'internal_error', message: 'Could not commit activation' };
    }
  }
}
