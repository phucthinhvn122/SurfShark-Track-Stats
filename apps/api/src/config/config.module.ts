// apps/api/src/config/config.module.ts
import { Global, Module } from '@nestjs/common';
import { loadEnv } from './env.config';

export const ENV = Symbol('ENV');

/** Validates env on boot and provides a typed config object to the DI container. */
@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: () => loadEnv(),
    },
  ],
  exports: [ENV],
})
export class ConfigModule {}
