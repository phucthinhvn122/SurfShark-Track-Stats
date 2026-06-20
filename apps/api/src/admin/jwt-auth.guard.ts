// apps/api/src/admin/jwt-auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../common/app-exception';
import { ErrorCode } from '@surfshark/shared';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppException(ErrorCode.UNAUTHORIZED, 'Missing token', HttpStatus.UNAUTHORIZED);
    try {
      req.user = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
        issuer: 'surfshark-activation',
        audience: 'surfshark-admin',
      });
      return true;
    } catch {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Invalid or expired token', HttpStatus.UNAUTHORIZED);
    }
  }
}
