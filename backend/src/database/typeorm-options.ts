import type { DataSourceOptions } from 'typeorm';

import { JobOutboxEntity, ProcessingJobEntity } from '../jobs/entities';
import { CreateJobsSchema1783900800000 } from './migrations/1783900800000-CreateJobsSchema';

export function createTypeOrmOptions(databaseUrl: string): DataSourceOptions {
  return {
    entities: [ProcessingJobEntity, JobOutboxEntity],
    migrations: [CreateJobsSchema1783900800000],
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    type: 'postgres',
    url: databaseUrl,
  };
}
