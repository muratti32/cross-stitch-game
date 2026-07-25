import { Module, forwardRef } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';

import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { JobsWorkerModule } from './jobs';
import { EmailAuthWorkerModule } from './auth/email-auth-worker.module';
import { AiArtworkModule } from './ai-artwork/ai-artwork.module';
import { SupportModule } from './support/support.module';
import { AccountDeletionModule } from './deletion/account-deletion.module';
import { isSentryEnabled } from './observability';

@Module({
  imports: [
    ...(isSentryEnabled ? [SentryModule.forRoot()] : []),
    AppConfigModule,
    DatabaseModule,
    JobsWorkerModule,
    EmailAuthWorkerModule,
    AiArtworkModule,
    SupportModule,
    forwardRef(() => require('./deletion/account-deletion.module').AccountDeletionModule),
  ],
})
export class WorkerAppModule {}
