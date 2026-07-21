import { Module } from '@nestjs/common';

import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { EmailAuthModule } from './auth/email-auth.module';
import { FirebaseAuthModule } from './auth/firebase-auth.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { CatalogModule } from './catalog/catalog.module';
import { SessionsModule } from './sessions/sessions.module';
import { ConversionModule } from './conversion';
import { EconomyModule } from './economy/economy.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    EmailAuthModule,
    FirebaseAuthModule,
    HealthModule,
    JobsModule,
    CatalogModule,
    SessionsModule,
    ConversionModule,
    EconomyModule,
    AdminModule,
  ],
})
export class ApiAppModule {}
