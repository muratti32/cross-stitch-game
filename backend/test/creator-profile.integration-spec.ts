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
  ReservedUsernameEntity,
} from '../src/creator-profile/entities';
import { ProfileSafetyService } from '../src/creator-profile/profile-safety.service';
import { ProfileTextPolicyService } from '../src/creator-profile/profile-text-policy.service';
import { CreateAuthSchema1783987200000 } from '../src/database/migrations/1783987200000-CreateAuthSchema';
import { CreateEmailAuthSchema1784160000001 } from '../src/database/migrations/1784160000001-CreateEmailAuthSchema';
import { CreateCreatorProfiles1786060800000 } from '../src/database/migrations/1786060800000-CreateCreatorProfiles';
import { CreateReservedUsernames1786406400000 } from '../src/database/migrations/1786406400000-CreateReservedUsernames';
import { AddCreatorProfileRestriction1786579200000 } from '../src/database/migrations/1786579200000-AddCreatorProfileRestriction';

describe('Creator Profile persistence', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      entities: [CreatorProfileEntity, CreatorProfileAuditEntity, ReservedUsernameEntity],
      migrations: [
        CreateAuthSchema1783987200000,
        CreateEmailAuthSchema1784160000001,
        CreateCreatorProfiles1786060800000,
        CreateReservedUsernames1786406400000,
        AddCreatorProfileRestriction1786579200000,
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

  it('never allows a permanently reserved username to be claimed again', async () => {
    const releasedFromProfileId = randomUUID();
    const releasedFromAccountId = randomUUID();
    await dataSource.query('INSERT INTO auth.registered_accounts (id) VALUES ($1)', [
      releasedFromAccountId,
    ]);
    await dataSource.query(
      `INSERT INTO moderation.creator_profiles (id, account_id, username, display_name)
       VALUES ($1, $2, 'creator_deadbeef', 'Reset Creator')`,
      [releasedFromProfileId, releasedFromAccountId],
    );
    await dataSource.query(
      'INSERT INTO moderation.reserved_usernames (username, profile_id) VALUES ($1, $2)',
      ['creator_deadbeef', releasedFromProfileId],
    );

    const accountId = randomUUID();
    await dataSource.query('INSERT INTO auth.registered_accounts (id) VALUES ($1)', [accountId]);
    const storage: ObjectStorage = {
      delete: () => Promise.resolve(),
      exists: () => Promise.resolve(false),
      get: () => Promise.resolve(null),
      publicUrl: (key) => key,
      put: () => Promise.resolve(),
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
    const principal = { id: accountId, tokenVersion: 1, type: PrincipalType.Account };

    await expect(
      service.create(
        principal,
        { displayName: 'New Name', username: 'creator_deadbeef' },
        undefined,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('masks a restricted profile in public view and blocks edits and avatar access, without destroying stored values', async () => {
    const accountId = randomUUID();
    const profileId = randomUUID();
    await dataSource.query('INSERT INTO auth.registered_accounts (id) VALUES ($1)', [accountId]);
    const objects = new Map<string, Buffer>();
    objects.set('creator-profiles/restricted/avatar.png', Buffer.from('avatar-bytes'));
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
    await dataSource.query(
      `INSERT INTO moderation.creator_profiles
        (id, account_id, username, display_name, avatar_object_key, avatar_content_type, avatar_checksum, restricted_at)
       VALUES ($1, $2, 'violating_user', 'Violating Name', 'creator-profiles/restricted/avatar.png', 'image/png', 'chk', now())`,
      [profileId, accountId],
    );

    const publicView = await service.getPublic(profileId);
    expect(publicView.displayName).toBe('Restricted Creator');
    expect(publicView.avatarUrl).toBeNull();
    expect(publicView.username).toBe('violating_user');
    expect(publicView.restricted).toBe(true);

    await expect(service.getAvatar(profileId)).rejects.toMatchObject({ status: 404 });

    const principal = { id: accountId, tokenVersion: 1, type: PrincipalType.Account };
    await expect(
      service.update(principal, { displayName: 'New Name' }, undefined),
    ).rejects.toMatchObject({ status: 403 });

    // The owner's own view is unmasked and the stored data is untouched.
    await expect(service.getMine(principal)).resolves.toMatchObject({
      displayName: 'Violating Name',
      restricted: true,
      username: 'violating_user',
    });
    const stored = await dataSource.query<{ display_name: string; username: string }[]>(
      'SELECT display_name, username FROM moderation.creator_profiles WHERE id = $1',
      [profileId],
    );
    expect(stored).toEqual([{ display_name: 'Violating Name', username: 'violating_user' }]);
  });
});
