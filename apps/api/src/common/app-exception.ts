// apps/api/src/common/app-exception.ts
import { HttpException, HttpStatus } from '@nestjs/common';

/** Domain error mapped to a uniform { success:false, error:{code,message} } envelope. */
export class AppException extends HttpException {
  constructor(code: string, message: string, status: HttpStatus) {
    super({ success: false, error: { code, message } }, status);
  }
}
