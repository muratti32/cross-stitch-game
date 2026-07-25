import { Module } from '@nestjs/common';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { AccountDeletionModule } from './deletion';
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
import { PromotionModule } from './promotion/promotion.module';
import { AiArtworkModule } from './ai-artwork/ai-artwork.module';
import { SupportModule } from './support/support.module';
import { CreatorProfileModule } from './creator-profile';
import { SocialModule } from './social/social.module';
import { EventsModule } from './events';
import {
  isSentryEnabled,
  SentryRequestContextInterceptor,
} from './observability';

@Module({
  imports: [
    ...(isSentryEnabled ? [SentryModule.forRoot()] : []),
    AccountDeletionModule,
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
    PromotionModule,
    AiArtworkModule,
    SupportModule,
    CreatorProfileModule,
    SocialModule,
    EventsModule,
    AdminModule,
  ],
  providers: isSentryEnabled
    ? [
        {
          provide: APP_FILTER,
          useClass: SentryGlobalFilter,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: SentryRequestContextInterceptor,
        },
      ]
    : [],
})
export class ApiAppModule {}
