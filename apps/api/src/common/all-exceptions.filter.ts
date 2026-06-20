// apps/api/src/common/all-exceptions.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ErrorCode } from '@surfshark/shared';

/**
 * Global filter → every error becomes a uniform
 * { success:false, error:{ code, message } } envelope.
 * FIX (audit): non-AppException errors previously leaked Nest's raw shape and
 * internal messages/stacks to clients. Now internals are logged server-side
 * only and clients get a safe generic message.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      // already-shaped envelopes (AppException) pass through
      if (body && typeof body === 'object' && body.error) {
        return res.status(status).json(body);
      }
      // built-in HttpExceptions (e.g. throttler 429) → normalise
      const message = typeof body === 'string' ? body : body?.message ?? exception.message;
      const code = status === HttpStatus.TOO_MANY_REQUESTS ? ErrorCode.RATE_LIMITED : ErrorCode.VALIDATION;
      return res.status(status).json({ success: false, error: { code, message } });
    }

    // unknown/internal error → log full detail, return safe message
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: ErrorCode.INTERNAL, message: 'Internal server error' },
    });
  }
}
