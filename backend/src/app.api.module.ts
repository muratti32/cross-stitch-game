import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { CatalogModule } from './catalog/catalog.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    JobsModule,
    CatalogModule,
  ],
})
export class ApiAppModule {}

