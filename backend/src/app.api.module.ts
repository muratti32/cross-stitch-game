import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { EmailAuthModule } from './auth/email-auth.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { CatalogModule } from './catalog/catalog.module';
import { SessionsModule } from './sessions/sessions.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    EmailAuthModule,
    HealthModule,
    JobsModule,
    CatalogModule,
    SessionsModule,
  ],
})
export class ApiAppModule {}
