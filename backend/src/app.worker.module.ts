import { Module } from '@nestjs/common';

import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { JobsWorkerModule } from './jobs';
import { EmailAuthWorkerModule } from './auth/email-auth-worker.module';
import { AiArtworkModule } from './ai-artwork/ai-artwork.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    JobsWorkerModule,
    EmailAuthWorkerModule,
    AiArtworkModule,
  ],
})
export class WorkerAppModule {}
