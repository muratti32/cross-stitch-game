import { Module } from '@nestjs/common';

import { AppConfigModule } from '../config/app-config.module';
import { DatabaseModule } from '../database/database.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  imports: [AppConfigModule, DatabaseModule],
  providers: [HealthService],
})
export class HealthModule {}
