// apps/api/src/main.ts
import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadEnv } from './config/env.config';

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'https://surfshark-activate.vercel.app'];
const VERCEL_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

function allowedWebOrigins(webOrigin: string): string[] {
  const configuredOrigins = webOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);
  return Array.from(new Set([...configuredOrigins, ...DEFAULT_ALLOWED_ORIGINS]));
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  return allowedOrigins.includes(origin) || VERCEL_PREVIEW_ORIGIN.test(origin);
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
  });
}

async function bootstrap(): Promise<void> {
  const env = loadEnv(); // fail fast on misconfiguration

  const app: INestApplication = await NestFactory.create(AppModule, { bufferLogs: true });

  // Render/Vercel terminate TLS at a proxy. Trust the first hop so Express
  // surfaces the real client IP via req.ip (required by throttler + audit logs).
  const expressApp = app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void };
  expressApp.set('trust proxy', 1);

  app.useLogger(app.get(Logger));
  // WEB_ORIGIN may be a single URL or a comma-separated list of allowed origins
  // (useful for supporting production + Vercel preview deployments).
  const allowedOrigins = allowedWebOrigins(env.WEB_ORIGIN);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", ...allowedOrigins, 'https://*.vercel.app'],
        },
      },
    }),
  );
  app.enableCors({
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin, allowedOrigins));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: false,
  });

  app.enableShutdownHooks();
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`API listening on :${env.PORT}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
