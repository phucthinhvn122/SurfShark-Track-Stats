// apps/api/src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { QueriesService } from './queries.service';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LicenseModule } from '../license/license.module';

@Module({
  imports: [
    LicenseModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService, QueriesService, SettingsService, JwtAuthGuard],
})
export class AdminModule {}
