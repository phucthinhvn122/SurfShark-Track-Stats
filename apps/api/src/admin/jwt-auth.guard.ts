// apps/api/src/admin/jwt-auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../common/app-exception';
import { ErrorCode } from '@surfshark/shared';
import { loadEnv } from '../config/env.config';

const JWT_ISS = 'surfshark-activation';
const JWT_AUD = 'surfshark-admin';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Missing token', HttpStatus.UNAUTHORIZED);
    }
    try {
      req.user = await this.jwt.verifyAsync(token, {
        secret: loadEnv().JWT_SECRET,
        issuer: JWT_ISS,
        audience: JWT_AUD,
      });
      return true;
    } catch {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Invalid or expired token', HttpStatus.UNAUTHORIZED);
    }
  }
}
