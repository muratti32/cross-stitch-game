import type { DataSourceOptions } from 'typeorm';

import {
  GuestInstallationEntity,
  AuthIdentityEntity,
  EmailVerificationCodeEntity,
  RefreshTokenEntity,
  RegisteredAccountEntity,
} from '../auth/entities';
import { EmailOutboxEntity } from '../auth/email-outbox.entity';
import {
  PatternEntity,
  TagEntity,
  TagLabelEntity,
  StaffPickEntity,
} from '../catalog/entities';
import { JobOutboxEntity, ProcessingJobEntity } from '../jobs/entities';
import {
  StitchingSessionEntity,
  SessionProgressFlagEntity,
  ObjectRegistryEntity,
} from '../sessions/entities';
import { CreateAuthSchema1783987200000 } from './migrations/1783987200000-CreateAuthSchema';
import { CreateJobsSchema1783900800000 } from './migrations/1783900800000-CreateJobsSchema';
import { CreateCatalogSchema1784073600000 } from './migrations/1784073600000-CreateCatalogSchema';
import { CreateSessionsSchema1784160000000 } from './migrations/1784160000000-CreateSessionsSchema';
import { CreateEmailAuthSchema1784160000001 } from './migrations/1784160000001-CreateEmailAuthSchema';

export function createTypeOrmOptions(databaseUrl: string): DataSourceOptions {
  return {
    entities: [
      ProcessingJobEntity,
      JobOutboxEntity,
      GuestInstallationEntity,
      RegisteredAccountEntity,
      AuthIdentityEntity,
      EmailVerificationCodeEntity,
      RefreshTokenEntity,
      EmailOutboxEntity,
      PatternEntity,
      TagEntity,
      TagLabelEntity,
      StaffPickEntity,
      StitchingSessionEntity,
      SessionProgressFlagEntity,
      ObjectRegistryEntity,
    ],
    migrations: [
      CreateJobsSchema1783900800000,
      CreateAuthSchema1783987200000,
      CreateCatalogSchema1784073600000,
      CreateSessionsSchema1784160000000,
      CreateEmailAuthSchema1784160000001,
    ],
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    type: 'postgres',
    url: databaseUrl,
  };
}
