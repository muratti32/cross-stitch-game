import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { PrincipalType } from '../src/auth/entities';
import type { ObjectStorage } from '../src/catalog/storage/object-storage.interface';
import { AppConfigService } from '../src/config/app-config.service';
import { CreatorProfileService } from '../src/creator-profile/creator-profile.service';
import {
  CreatorProfileAuditEntity,
  CreatorProfileEntity,
} from '../src/creator-profile/entities';
import { ProfileSafetyService } from '../src/creator-profile/profile-safety.service';
import { ProfileTextPolicyService } from '../src/creator-profile/profile-text-policy.service';
import { CreateAuthSchema1783987200000 } from '../src/database/migrations/1783987200000-CreateAuthSchema';
import { CreateEmailAuthSchema1784160000001 } from '../src/database/migrations/1784160000001-CreateEmailAuthSchema';
import { CreateCreatorProfiles1786060800000 } from '../src/database/migrations/1786060800000-CreateCreatorProfiles';

describe('Creator Profile persistence', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      entities: [CreatorProfileEntity, CreatorProfileAuditEntity],
      migrations: [
        CreateAuthSchema1783987200000,
        CreateEmailAuthSchema1784160000001,
        CreateCreatorProfiles1786060800000,
      ],
      migrationsTableName: 'typeorm_migrations',
      synchronize: false,
      type: 'postgres',
      url: postgres.getConnectionUri(),
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized === true) await dataSource.destroy();
    if (postgres !== undefined) await postgres.stop();
  });

  it('enforces global username and one-profile-per-account constraints', async () => {
    const firstAccountId = randomUUID();
    const secondAccountId = randomUUID();
    await dataSource.query(
      `INSERT INTO auth.registered_accounts (id) VALUES ($1), ($2)`,
      [firstAccountId, secondAccountId],
    );
    await dataSource.query(
      `INSERT INTO moderation.creator_profiles
        (account_id, username, display_name)
       VALUES ($1, 'needle_artist', 'Needle Artist')`,
      [firstAccountId],
    );

    await expect(
      dataSource.query(
        `INSERT INTO moderation.creator_profiles
          (account_id, username, display_name)
         VALUES ($1, 'needle_artist', 'Other Artist')`,
        [secondAccountId],
      ),
    ).rejects.toMatchObject({ constraint: 'UQ_creator_profiles_username' });
    await expect(
      dataSource.query(
        `INSERT INTO moderation.creator_profiles
          (account_id, username, display_name)
         VALUES ($1, 'another_name', 'Needle Artist Again')`,
        [firstAccountId],
      ),
    ).rejects.toMatchObject({ constraint: 'UQ_creator_profiles_account' });
    await expect(
      dataSource.query(
        `UPDATE moderation.creator_profiles
         SET username = 'renamed_artist' WHERE account_id = $1`,
        [firstAccountId],
      ),
    ).rejects.toThrow('Creator Profile username is immutable');
  });

  it('retains versioned values in an audit table that PostgreSQL keeps append-only', async () => {
    const accountId = randomUUID();
    const profileId = randomUUID();
    await dataSource.query(
      'INSERT INTO auth.registered_accounts (id) VALUES ($1)',
      [accountId],
    );
    await dataSource.query(
      `INSERT INTO moderation.creator_profiles
        (id, account_id, username, display_name, version)
       VALUES ($1, $2, 'history_artist', 'First Name', 1)`,
      [profileId, accountId],
    );
    await dataSource.query(
      `INSERT INTO moderation.creator_profile_audit
        (profile_id, version, username, display_name, actor_type, actor_id, reason)
       VALUES ($1, 1, 'history_artist', 'First Name', 'account', $2, 'profile_created')`,
      [profileId, accountId],
    );
    await dataSource.query(
      `UPDATE moderation.creator_profiles
       SET display_name = 'Second Name', version = 2
       WHERE id = $1`,
      [profileId],
    );
    await dataSource.query(
      `INSERT INTO moderation.creator_profile_audit
        (profile_id, version, username, display_name, actor_type, actor_id, reason)
       VALUES ($1, 2, 'history_artist', 'Second Name', 'account', $2, 'profile_updated')`,
      [profileId, accountId],
    );

    const history = await dataSource.query<
      Array<{ display_name: string; version: number }>
    >(
      `SELECT version, display_name
       FROM moderation.creator_profile_audit
       WHERE profile_id = $1 ORDER BY version`,
      [profileId],
    );
    expect(history).toEqual([
      { display_name: 'First Name', version: 1 },
      { display_name: 'Second Name', version: 2 },
    ]);
    await expect(
      dataSource.query(
        `UPDATE moderation.creator_profile_audit
         SET display_name = 'mutated' WHERE profile_id = $1`,
        [profileId],
      ),
    ).rejects.toThrow('Creator Profile Audit is append-only');
    await expect(
      dataSource.query(
        'DELETE FROM moderation.creator_profile_audit WHERE profile_id = $1',
        [profileId],
      ),
    ).rejects.toThrow('Creator Profile Audit is append-only');
  });

  it('publishes passing updates immediately and keeps the accepted profile untouched after rejection', async () => {
    const accountId = randomUUID();
    await dataSource.query(
      'INSERT INTO auth.registered_accounts (id) VALUES ($1)',
      [accountId],
    );
    const objects = new Map<string, Buffer>();
    const storage: ObjectStorage = {
      delete: (key) => {
        objects.delete(key);
        return Promise.resolve();
      },
      exists: (key) => Promise.resolve(objects.has(key)),
      get: (key) => Promise.resolve(objects.get(key) ?? null),
      publicUrl: (key) => key,
      put: (key, bytes) => {
        objects.set(key, bytes);
        return Promise.resolve();
      },
    };
    const textPolicy = new ProfileTextPolicyService();
    const safety = new ProfileSafetyService(
      { openAiModerationEnabled: false } as AppConfigService,
      textPolicy,
    );
    const service = new CreatorProfileService(
      dataSource,
      dataSource.getRepository(CreatorProfileEntity),
      storage,
      safety,
      textPolicy,
    );
    const principal = {
      id: accountId,
      tokenVersion: 1,
      type: PrincipalType.Account,
    };
    const username = `safe_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

    const created = await service.create(
      principal,
      { displayName: 'First Accepted Name', username },
      undefined,
    );
    expect(created).not.toHaveProperty('accountId');
    expect(created).not.toHaveProperty('email');
    expect(created).not.toHaveProperty('provider');
    await expect(
      service.update(principal, { displayName: 'Official Team' }, undefined),
    ).rejects.toMatchObject({
      response: { reason: 'Display name contains a reserved name' },
      status: 422,
    });
    await expect(service.getMine(principal)).resolves.toMatchObject({
      displayName: 'First Accepted Name',
      id: created.id,
      username,
    });
    await expect(
      dataSource.query<{ count: string }[]>(
        'SELECT count(*) FROM moderation.creator_profile_audit WHERE profile_id = $1',
        [created.id],
      ),
    ).resolves.toEqual([{ count: '1' }]);

    await expect(
      service.update(principal, { displayName: 'Second Accepted Name' }, undefined),
    ).resolves.toMatchObject({ displayName: 'Second Accepted Name', id: created.id });
    await expect(service.getPublic(created.id)).resolves.toMatchObject({
      displayName: 'Second Accepted Name',
      username,
    });
    await expect(
      dataSource.query<{ display_name: string; version: number }[]>(
        `SELECT display_name, version
         FROM moderation.creator_profile_audit
         WHERE profile_id = $1 ORDER BY version`,
        [created.id],
      ),
    ).resolves.toEqual([
      { display_name: 'First Accepted Name', version: 1 },
      { display_name: 'Second Accepted Name', version: 2 },
    ]);
  });
});
