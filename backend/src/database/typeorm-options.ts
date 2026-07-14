import type { DataSourceOptions } from 'typeorm';

import {
  GuestInstallationEntity,
  RefreshTokenEntity,
} from '../auth/entities';
import { JobOutboxEntity, ProcessingJobEntity } from '../jobs/entities';
import { CreateAuthSchema1783987200000 } from './migrations/1783987200000-CreateAuthSchema';
import { CreateJobsSchema1783900800000 } from './migrations/1783900800000-CreateJobsSchema';

export function createTypeOrmOptions(databaseUrl: string): DataSourceOptions {
  return {
    entities: [
      ProcessingJobEntity,
      JobOutboxEntity,
      GuestInstallationEntity,
      RefreshTokenEntity,
    ],
    migrations: [
      CreateJobsSchema1783900800000,
      CreateAuthSchema1783987200000,
    ],
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    type: 'postgres',
    url: databaseUrl,
  };
}
