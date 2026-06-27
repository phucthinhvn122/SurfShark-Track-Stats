// apps/api/src/activation/activation.controller.ts
import { Controller, Post, Get, Body, Param, Req, UsePipes, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ActivationService } from './activation.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { deviceLoginSchema, type DeviceLoginInput } from '@surfshark/shared';

@Controller()
export class ActivationController {
  constructor(private readonly service: ActivationService) {}

  /**
   * POST /login — 5 req/min/IP. Accepts a 6-character device code; the worker
   * sends `/login <code>` to the Surfshark bot. Returns 202 with a requestId.
   */
  @Post('login')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(deviceLoginSchema))
  async login(@Body() body: DeviceLoginInput, @Req() req: Request) {
    const ip = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
    const data = await this.service.activate(body, {
      ip,
      ua: req.headers['user-agent'],
      country: (req.headers['x-vercel-ip-country'] as string) || undefined,
    });
    return { success: true, data };
  }

  /** GET /status/:requestId — 30 req/min/IP. Polled by the frontend. */
  @Get('status/:requestId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async status(@Param('requestId') requestId: string) {
    const data = await this.service.getStatus(requestId);
    return { success: true, data };
  }
}
