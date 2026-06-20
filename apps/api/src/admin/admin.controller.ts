// apps/api/src/admin/admin.controller.ts
import { Controller, Post, Patch, Delete, Get, Body, Query, UseGuards, Req, Res, UsePipes } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AdminService } from './admin.service';
import { QueriesService } from './queries.service';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { adminLoginSchema, bulkCreateSchema, keyActionSchema, settingsUpdateSchema } from '@surfshark/shared';

/** Extract the real client IP behind Vercel/Render proxies (trust proxy set). */
function clientIp(r: any): string | undefined {
  return r.ip || (r.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
}

@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly queries: QueriesService,
    private readonly settings: SettingsService,
  ) {}

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // brute-force guard
  @UsePipes(new ZodValidationPipe(adminLoginSchema))
  async login(@Body() body: { username: string; password: string }, @Req() r: any) {
    return { success: true, data: await this.admin.login(body.username, body.password, clientIp(r)) };
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @UseGuards(JwtAuthGuard)
  @Post('keys/bulk-create')
  @UsePipes(new ZodValidationPipe(bulkCreateSchema))
  bulkCreate(@Body() b: { count: number; notes?: string }, @Req() r: any) {
    return this.admin.bulkCreate(b.count, b.notes, r.user.sub, clientIp(r));
  }

  @UseGuards(JwtAuthGuard)
  @Patch('keys/ban')
  ban(@Body(new ZodValidationPipe(keyActionSchema)) b: any, @Req() r: any) {
    return this.admin.ban(b.licenseKey, r.user.sub, clientIp(r));
  }

  @UseGuards(JwtAuthGuard)
  @Patch('keys/unban')
  unban(@Body(new ZodValidationPipe(keyActionSchema)) b: any, @Req() r: any) {
    return this.admin.unban(b.licenseKey, r.user.sub, clientIp(r));
  }

  @UseGuards(JwtAuthGuard)
  @Patch('keys/extend')
  extend(@Body(new ZodValidationPipe(keyActionSchema)) b: any, @Req() r: any) {
    return this.admin.extend(b.licenseKey, b.days ?? 30, r.user.sub, clientIp(r));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('keys/delete')
  remove(@Body(new ZodValidationPipe(keyActionSchema)) b: any, @Req() r: any) {
    return this.admin.remove(b.licenseKey, r.user.sub, clientIp(r));
  }

  // ---- read-only listings ----
  @UseGuards(JwtAuthGuard)
  @Get('keys')
  keys(@Query('status') status?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.queries.keys({ status, search, page: page ? +page : 1, limit: limit ? +limit : 20 });
  }

  @UseGuards(JwtAuthGuard)
  @Get('keys/export')
  async exportCsv(@Res() res: Response) {
    const csv = await this.queries.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="licenses.csv"');
    res.send(csv);
  }

  @UseGuards(JwtAuthGuard)
  @Get('users')
  users(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.queries.users({ page: page ? +page : 1, limit: limit ? +limit : 20 });
  }

  @UseGuards(JwtAuthGuard)
  @Get('logs')
  logs(@Query('type') type = 'activation') {
    return this.queries.logs(type);
  }

  // ---- settings ----
  @UseGuards(JwtAuthGuard)
  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @UseGuards(JwtAuthGuard)
  @Patch('settings')
  updateSettings(@Body(new ZodValidationPipe(settingsUpdateSchema)) body: any, @Req() r: any) {
    return this.settings.update(body);
  }
}
