// apps/api/src/main.ts
import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { z } from 'zod';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1, environment: process.env.NODE_ENV });
}

// Fail fast if env is misconfigured.
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  SESSION_ENC_KEY: z.string().min(32),
  WEB_ORIGIN: z.string().url(),
  PORT: z.string().default('3001'),
});

async function bootstrap() {
  const env = envSchema.parse(process.env);

  const app: INestApplication = await NestFactory.create(AppModule, { bufferLogs: true });

  // FIX (audit): Render/Vercel terminate TLS at a proxy. Trust the first hop so
  // Express surfaces the real client IP via req.ip. @nestjs/throttler's default
  // tracker uses req.ip — without this every request appears to come from the
  // proxy, collapsing per-IP limits into a single global bucket (DoS + global
  // admin lockout).
  const expressApp = app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void };
  expressApp.set('trust proxy', 1);

  app.useLogger(app.get(Logger)); // route Nest logs through pino
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", env.WEB_ORIGIN],
        },
      },
    }),
  );
  // Bearer-token auth (no cookies) → credentials not needed; smaller CORS surface.
  app.enableCors({ origin: env.WEB_ORIGIN, methods: ['GET', 'POST', 'PATCH', 'DELETE'], credentials: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  app.enableShutdownHooks(); // drain Prisma/Redis on SIGTERM (Render redeploys)

  await app.listen(Number(env.PORT));
  console.log(`API listening on :${env.PORT}`);
}
bootstrap();
