import { Module } from '@nestjs/common';

import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { JobsWorkerModule } from './jobs';

@Module({
  imports: [AppConfigModule, DatabaseModule, JobsWorkerModule],
})
export class WorkerAppModule {}
