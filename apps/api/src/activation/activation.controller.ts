// apps/api/src/activation/activation.controller.ts
import { Controller, Post, Get, Body, Param, Req, UsePipes, HttpCode, Sse, MessageEvent } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import { ActivationService } from './activation.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { deviceLoginSchema, type DeviceLoginInput } from '@surfshark/shared';

@Controller()
export class ActivationController {
  constructor(private readonly service: ActivationService) {}

  /**
   * POST /login - 5 req/min/IP. Requires a DB-backed license key and a
   * 6-character device code; the worker sends `/login <code>` to Surfshark.
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

  /** GET /status/:requestId - 30 req/min/IP. Polled by the frontend. */
  @Get('status/:requestId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async status(@Param('requestId') requestId: string) {
    const data = await this.service.getStatus(requestId);
    return { success: true, data };
  }

  /**
   * GET /status/:requestId/stream — Server-Sent Events that push status
   * updates the moment the worker writes them. Eliminates the 0-1500ms polling
   * lag, so a 4s bot round-trip now shows the result in ~4s instead of ~5s.
   *
   * The first emitted event is the current status (so the client doesn't
   * need a separate GET /status request). A `ping` event is sent every 15s
   * so the connection survives idle proxies.
   */
  @Sse('status/:requestId/stream')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  stream(@Param('requestId') requestId: string, @Req() req: Request): Observable<MessageEvent> {
    const redisUrl = process.env.REDIS_URL!;
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      // Dedicated connection for SUBSCRIBE — ioredis requires a separate
      // connection because subscribed connections can't run normal commands.
      const IORedis = require('ioredis');
      const sub = new IORedis(redisUrl, { maxRetriesPerRequest: null });

      const cleanup = () => {
        if (closed) return;
        closed = true;
        try { sub.disconnect(); } catch { /* noop */ }
      };

      sub.on('message', (channel: string, raw: string) => {
        if (channel !== 'status:events') return;
        try {
          const evt = JSON.parse(raw);
          if (evt?.requestId !== requestId) return;
          if (closed) return;
          subscriber.next({ type: 'status', data: JSON.stringify(evt.status) });
        } catch {
          /* ignore malformed payloads */
        }
      });

      // CRITICAL: await SUBSCRIBE before doing anything else. Any PUBLISH that
      // happens after this point is guaranteed to be delivered to the message
      // handler above. Otherwise the worker could write the terminal status
      // between our subscribe() call and the SUBSCRIBE arriving at the Redis
      // server, and we'd silently miss the success event.
      sub
        .subscribe('status:events')
        .then(() => {
          if (closed) return;
          // Send the current status immediately so the client doesn't have to
          // also call GET /status.
          return this.service.getStatus(requestId).then((status) => {
            if (closed) return;
            subscriber.next({ type: 'status', data: JSON.stringify(status) });
            if (status.state !== 'pending' && status.state !== 'processing') {
              setImmediate(() => {
                subscriber.complete();
                cleanup();
              });
            }
          });
        })
        .catch((e: Error) => {
          // eslint-disable-next-line no-console
          console.error(`[sse] subscribe failed for ${requestId}: ${e.message}`);
          if (closed) return;
          subscriber.next({
            type: 'error',
            data: JSON.stringify({ message: e.message }),
          });
        });

      // Keepalive ping every 15s so proxies don't drop the idle connection.
      const ping = setInterval(() => {
        if (closed) return;
        subscriber.next({ type: 'ping', data: String(Date.now()) });
      }, 15_000);

      // Close the Redis sub + ping timer when the client disconnects.
      const onClose = () => {
        clearInterval(ping);
        cleanup();
        subscriber.complete();
      };
      req.on('close', onClose);
      req.on('aborted', onClose);

      return cleanup;
    });
  }
}
