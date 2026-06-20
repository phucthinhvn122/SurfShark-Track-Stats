// apps/api/src/common/zod-validation.pipe.ts
import { PipeTransform, ArgumentMetadata } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { AppException } from './app-exception';
import { ErrorCode } from '@surfshark/shared';

/** Reusable pipe that validates a body/query against a Zod schema. */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _meta: ArgumentMetadata) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new AppException(
        ErrorCode.VALIDATION,
        first?.message ?? 'Invalid input',
        HttpStatus.BAD_REQUEST,
      );
    }
    return result.data;
  }
}
