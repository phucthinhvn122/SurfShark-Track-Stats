// apps/api/src/key-redeem/key-redeem.controller.ts
import { Body, Controller, HttpCode, Post, Req, UsePipes } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { KeyRedeemService } from './key-redeem.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { redeemKeySchema, type RedeemKeyInput, type RedeemResult } from '@surfshark/shared';

function clientIp(req: Request): string | undefined {
  return req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
}

@Controller('key-redeem')
export class KeyRedeemController {
  constructor(private readonly service: KeyRedeemService) {}

  /**
   * POST /key-redeem
   * Body: { key: "VPN-XXXX-XXXX" }
   * Returns the structured outcome (success or a specific reason) synchronously.
   */
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(redeemKeySchema))
  async redeem(@Body() body: RedeemKeyInput, @Req() req: Request): Promise<{ success: boolean; data: RedeemResult }> {
    const data = await this.service.redeem(body, {
      ip: clientIp(req),
      ua: req.headers['user-agent'],
      country: (req.headers['x-vercel-ip-country'] as string) || undefined,
    });
    return { success: true, data };
  }
}
