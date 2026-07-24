import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import type { ObjectStorage } from '../src/catalog/storage/object-storage.interface';
import { PrincipalType } from '../src/auth/entities';
import {
  CreatorProfileAuditEntity,
  CreatorProfileAuditEventEntity,
  CreatorProfileEntity,
  ProfileInvestigationEntity,
  ProfileReportEntity,
  ReservedUsernameEntity,
} from '../src/creator-profile/entities';
import { ProfileReportService } from '../src/creator-profile/profile-report.service';
import { CreateAuthSchema1783987200000 } from '../src/database/migrations/1783987200000-CreateAuthSchema';
import { CreateEmailAuthSchema1784160000001 } from '../src/database/migrations/1784160000001-CreateEmailAuthSchema';
import { CreateAdminAuthSchema1784592000000 } from '../src/database/migrations/1784592000000-CreateAdminAuthSchema';
import { CreateCreatorProfiles1786060800000 } from '../src/database/migrations/1786060800000-CreateCreatorProfiles';
import { CreateProfileReports1786320000000 } from '../src/database/migrations/1786320000000-CreateProfileReports';
import { CreateReservedUsernames1786406400000 } from '../src/database/migrations/1786406400000-CreateReservedUsernames';
import { AllowModeratorUsernameReset1786492800000 } from '../src/database/migrations/1786492800000-AllowModeratorUsernameReset';

const ACCOUNT = PrincipalType.Account;

describe('Profile Report intake and Profile Investigation', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let service: ProfileReportService;
  let storageObjects: Map<string, Buffer>;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      entities: [
        CreatorProfileEntity,
        CreatorProfileAuditEntity,
        CreatorProfileAuditEventEntity,
        ProfileInvestigationEntity,
        ProfileReportEntity,
        ReservedUsernameEntity,
      ],
      migrations: [
        CreateAuthSchema1783987200000,
        CreateEmailAuthSchema1784160000001,
        CreateAdminAuthSchema1784592000000,
        CreateCreatorProfiles1786060800000,
        CreateProfileReports1786320000000,
        CreateReservedUsernames1786406400000,
        AllowModeratorUsernameReset1786492800000,
      ],
      migrationsTableName: 'typeorm_migrations',
      synchronize: false,
      type: 'postgres',
      url: postgres.getConnectionUri(),
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    storageObjects = new Map<string, Buffer>();
    const storage: ObjectStorage = {
      delete: (key) => {
        storageObjects.delete(key);
        return Promise.resolve();
      },
      exists: (key) => Promise.resolve(storageObjects.has(key)),
      get: (key) => Promise.resolve(storageObjects.get(key) ?? null),
      publicUrl: (key) => key,
      put: (key, bytes) => {
        storageObjects.set(key, bytes);
        return Promise.resolve();
      },
    };
    service = new ProfileReportService(dataSource, storage);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized === true) await dataSource.destroy();
    if (postgres !== undefined) await postgres.stop();
  });

  async function seedProfile(username: string, version = 1): Promise<{ accountId: string; profileId: string }> {
    const accountId = randomUUID();
    const profileId = randomUUID();
    await dataSource.query('INSERT INTO auth.registered_accounts (id) VALUES ($1)', [accountId]);
    await dataSource.query(
      `INSERT INTO moderation.creator_profiles (id, account_id, username, display_name, version)
       VALUES ($1, $2, $3, 'Creator', $4)`,
      [profileId, accountId, username, version],
    );
    return { accountId, profileId };
  }

  async function seedAccount(): Promise<string> {
    const accountId = randomUUID();
    await dataSource.query('INSERT INTO auth.registered_accounts (id) VALUES ($1)', [accountId]);
    return accountId;
  }

  async function seedOperator(): Promise<string> {
    const operatorId = randomUUID();
    await dataSource.query(
      `INSERT INTO admin.operator_accounts
        (id, email, password_hash, totp_secret_encrypted)
       VALUES ($1, $2, 'hash', 'ciphertext')`,
      [operatorId, `operator_${operatorId}@example.test`],
    );
    return operatorId;
  }

  async function openInvestigation(profileId: string): Promise<string> {
    const reporter = await seedAccount();
    const result = await service.report(principal(reporter), profileId, { reasonCode: 'offensive' });
    return result.investigationId;
  }

  const principal = (id: string) => ({ id, tokenVersion: 1, type: ACCOUNT });

  it('opens one investigation, dedupes the same reporter, and attaches other reporters', async () => {
    const { profileId } = await seedProfile(`prof_${randomUUID().slice(0, 8).replace(/-/g, '')}`);
    const reporterA = await seedAccount();
    const reporterB = await seedAccount();

    const first = await service.report(principal(reporterA), profileId, { reasonCode: 'offensive' });
    expect(first.deduped).toBe(false);
    expect(first.status).toBe('open');

    // Repeat by the same account returns the same report without multiplying.
    const repeat = await service.report(principal(reporterA), profileId, { reasonCode: 'spam', note: 'again' });
    expect(repeat.deduped).toBe(true);
    expect(repeat.report.id).toBe(first.report.id);
    expect(repeat.investigationId).toBe(first.investigationId);

    // A different account attaches to the same open investigation.
    const other = await service.report(principal(reporterB), profileId, { reasonCode: 'impersonation' });
    expect(other.deduped).toBe(false);
    expect(other.investigationId).toBe(first.investigationId);

    const investigations = await dataSource.query<{ count: string }[]>(
      'SELECT count(*) FROM moderation.profile_investigations WHERE profile_id = $1',
      [profileId],
    );
    expect(investigations).toEqual([{ count: '1' }]);

    const detail = await service.getInvestigation(first.investigationId);
    expect(detail.reportCount).toBe(2);
    expect(detail.reports).toHaveLength(2);
    expect(detail.status).toBe('open');
  });

  it('never mutates the reported profile and records append-only audit events', async () => {
    const { profileId } = await seedProfile(`prof_${randomUUID().slice(0, 8).replace(/-/g, '')}`);
    const reporter = await seedAccount();

    const before = await dataSource.query<{ display_name: string; version: number }[]>(
      'SELECT display_name, version FROM moderation.creator_profiles WHERE id = $1',
      [profileId],
    );
    const result = await service.report(principal(reporter), profileId, { reasonCode: 'other', note: 'bad' });
    const after = await dataSource.query<{ display_name: string; version: number }[]>(
      'SELECT display_name, version FROM moderation.creator_profiles WHERE id = $1',
      [profileId],
    );
    expect(after).toEqual(before);

    const events = await dataSource.query<{ actor_type: string; event_type: string; reason: string | null }[]>(
      `SELECT event_type, actor_type, reason FROM moderation.creator_profile_audit_events
       WHERE profile_id = $1 ORDER BY created_at`,
      [profileId],
    );
    expect(events).toEqual([
      { actor_type: 'system', event_type: 'investigation_opened', reason: 'profile_reported' },
      { actor_type: 'account', event_type: 'report_submitted', reason: 'other' },
    ]);
    await expect(
      dataSource.query(
        'UPDATE moderation.creator_profile_audit_events SET reason = $1 WHERE profile_id = $2',
        ['x', profileId],
      ),
    ).rejects.toThrow('Creator Profile Audit is append-only');
    await expect(
      dataSource.query(
        'DELETE FROM moderation.creator_profile_audit_events WHERE report_id = $1',
        [result.report.id],
      ),
    ).rejects.toThrow('Creator Profile Audit is append-only');
  });

  it('rejects self-reports and reports of unknown profiles', async () => {
    const { accountId, profileId } = await seedProfile(`prof_${randomUUID().slice(0, 8).replace(/-/g, '')}`);
    await expect(
      service.report(principal(accountId), profileId, { reasonCode: 'spam' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.report(principal(await seedAccount()), randomUUID(), { reasonCode: 'spam' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rate-limits re-reporting after closure until new state or cooldown', async () => {
    const { profileId } = await seedProfile(`prof_${randomUUID().slice(0, 8).replace(/-/g, '')}`);
    const reporter = await seedAccount();
    const opened = await service.report(principal(reporter), profileId, { reasonCode: 'offensive' });

    // Simulate the moderator close that ticket #55 will perform.
    await dataSource.query(
      `UPDATE moderation.profile_investigations
       SET status = 'closed', closed_at = now(), close_outcome = 'no_action'
       WHERE id = $1`,
      [opened.investigationId],
    );

    // Same public state, within cooldown -> blocked.
    await expect(
      service.report(principal(await seedAccount()), profileId, { reasonCode: 'spam' }),
    ).rejects.toMatchObject({ status: 429 });

    // A newly published profile state (version bump) permits a fresh case.
    await dataSource.query(
      'UPDATE moderation.creator_profiles SET version = version + 1 WHERE id = $1',
      [profileId],
    );
    const reopened = await service.report(principal(reporter), profileId, { reasonCode: 'offensive' });
    expect(reopened.investigationId).not.toBe(opened.investigationId);
    expect(reopened.status).toBe('open');

    const openCases = await dataSource.query<{ count: string }[]>(
      `SELECT count(*) FROM moderation.profile_investigations WHERE profile_id = $1 AND status = 'open'`,
      [profileId],
    );
    expect(openCases).toEqual([{ count: '1' }]);
  });

  it('exposes open investigations to operators', async () => {
    const { profileId } = await seedProfile(`prof_${randomUUID().slice(0, 8).replace(/-/g, '')}`);
    const created = await service.report(principal(await seedAccount()), profileId, { reasonCode: 'spam' });
    const open = await service.listInvestigations('open');
    expect(open.some((row) => row.id === created.investigationId)).toBe(true);
    await expect(service.listInvestigations('bogus')).rejects.toMatchObject({ status: 400 });
  });

  it('closes an investigation without action and leaves the profile untouched', async () => {
    const { profileId } = await seedProfile(`prof_${randomUUID().slice(0, 8).replace(/-/g, '')}`);
    const investigationId = await openInvestigation(profileId);
    const operatorId = await seedOperator();

    const before = await dataSource.query<{ display_name: string; version: number }[]>(
      'SELECT display_name, version FROM moderation.creator_profiles WHERE id = $1',
      [profileId],
    );
    const view = await service.close(operatorId, investigationId, 'reviewed, no violation');
    expect(view.status).toBe('closed');

    const after = await dataSource.query<{ display_name: string; version: number }[]>(
      'SELECT display_name, version FROM moderation.creator_profiles WHERE id = $1',
      [profileId],
    );
    expect(after).toEqual(before);

    const row = await dataSource.query<
      { status: string; close_outcome: string; closed_by: string }[]
    >(
      'SELECT status, close_outcome, closed_by FROM moderation.profile_investigations WHERE id = $1',
      [investigationId],
    );
    expect(row).toEqual([{ close_outcome: 'no_action', closed_by: operatorId, status: 'closed' }]);

    const event = await dataSource.query<{ event_type: string; actor_type: string; reason: string }[]>(
      `SELECT event_type, actor_type, reason FROM moderation.creator_profile_audit_events
       WHERE investigation_id = $1 AND event_type = 'investigation_closed'`,
      [investigationId],
    );
    expect(event).toEqual([
      { actor_type: 'operator', event_type: 'investigation_closed', reason: 'reviewed, no violation' },
    ]);

    // Closing re-opens the rate-limited re-report window (new evidence still gated).
    await expect(
      service.report(principal(await seedAccount()), profileId, { reasonCode: 'spam' }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('rejects closing an investigation that is not open', async () => {
    const { profileId } = await seedProfile(`prof_${randomUUID().slice(0, 8).replace(/-/g, '')}`);
    const investigationId = await openInvestigation(profileId);
    const operatorId = await seedOperator();
    await service.close(operatorId, investigationId, 'first close');
    await expect(service.close(operatorId, investigationId, 'second close')).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      service.close(operatorId, randomUUID(), 'unknown'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('remediates a profile: resets display name, removes avatar, preserves username/access/patterns', async () => {
    const username = `prof_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
    const { accountId, profileId } = await seedProfile(username);
    const avatarKey = `creator-profiles/${profileId}/avatars/original.png`;
    storageObjects.set(avatarKey, Buffer.from('avatar-bytes'));
    await dataSource.query(
      `UPDATE moderation.creator_profiles
       SET avatar_object_key = $1, avatar_content_type = 'image/png', avatar_checksum = 'chk'
       WHERE id = $2`,
      [avatarKey, profileId],
    );

    const investigationId = await openInvestigation(profileId);
    const operatorId = await seedOperator();

    const view = await service.remediate(operatorId, investigationId, 'display name violated policy');
    expect(view.status).toBe('closed');

    const profileRows = await dataSource.query<
      {
        display_name: string;
        username: string;
        account_id: string;
        avatar_object_key: string | null;
        version: number;
      }[]
    >(
      `SELECT display_name, username, account_id, avatar_object_key, version
       FROM moderation.creator_profiles WHERE id = $1`,
      [profileId],
    );
    expect(profileRows).toEqual([
      {
        account_id: accountId,
        avatar_object_key: null,
        display_name: 'Creator',
        username,
        version: 2,
      },
    ]);
    expect(storageObjects.has(avatarKey)).toBe(false);

    const snapshot = await dataSource.query<
      { actor_type: string; actor_id: string; reason: string; version: number }[]
    >(
      'SELECT actor_type, actor_id, reason, version FROM moderation.creator_profile_audit WHERE profile_id = $1 AND version = 2',
      [profileId],
    );
    expect(snapshot).toEqual([
      { actor_id: operatorId, actor_type: 'operator', reason: 'display name violated policy', version: 2 },
    ]);

    const investigationRow = await dataSource.query<{ close_outcome: string; status: string }[]>(
      'SELECT close_outcome, status FROM moderation.profile_investigations WHERE id = $1',
      [investigationId],
    );
    expect(investigationRow).toEqual([{ close_outcome: 'remediated', status: 'closed' }]);

    const eventTypes = await dataSource.query<{ event_type: string }[]>(
      `SELECT event_type FROM moderation.creator_profile_audit_events
       WHERE investigation_id = $1 ORDER BY created_at`,
      [investigationId],
    );
    expect(eventTypes.map((row) => row.event_type)).toEqual([
      'investigation_opened',
      'report_submitted',
      'profile_remediated',
      'investigation_closed',
    ]);

    // The player can still submit compliant values afterward (no lockout).
    await dataSource.query(
      `UPDATE moderation.creator_profiles SET display_name = 'Compliant Name' WHERE id = $1`,
      [profileId],
    );
  });

  it('rejects remediating an investigation that is not open', async () => {
    const { profileId } = await seedProfile(`prof_${randomUUID().slice(0, 8).replace(/-/g, '')}`);
    const investigationId = await openInvestigation(profileId);
    const operatorId = await seedOperator();
    await service.remediate(operatorId, investigationId, 'violation');
    await expect(
      service.remediate(operatorId, investigationId, 'again'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('resets a violating username to a safe system-generated value and reserves the old one forever', async () => {
    const violatingUsername = `bad_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
    const { accountId, profileId } = await seedProfile(violatingUsername);
    const investigationId = await openInvestigation(profileId);
    const operatorId = await seedOperator();

    const view = await service.resetUsername(operatorId, investigationId, 'impersonating username');
    expect(view.status).toBe('closed');
    expect(view.newUsername).toMatch(/^[a-z0-9_]{3,30}$/);
    expect(view.newUsername).not.toBe(violatingUsername);

    const profileRows = await dataSource.query<
      { username: string; account_id: string; version: number }[]
    >('SELECT username, account_id, version FROM moderation.creator_profiles WHERE id = $1', [profileId]);
    expect(profileRows).toEqual([
      { account_id: accountId, username: view.newUsername, version: 2 },
    ]);

    // The opaque profile id, ownership, and old audit history are all untouched.
    const reservedRows = await dataSource.query<{ username: string; profile_id: string }[]>(
      'SELECT username, profile_id FROM moderation.reserved_usernames WHERE username = $1',
      [violatingUsername],
    );
    expect(reservedRows).toEqual([{ profile_id: profileId, username: violatingUsername }]);

    const investigationRow = await dataSource.query<{ close_outcome: string; status: string }[]>(
      'SELECT close_outcome, status FROM moderation.profile_investigations WHERE id = $1',
      [investigationId],
    );
    expect(investigationRow).toEqual([{ close_outcome: 'username_reset', status: 'closed' }]);

    const eventTypes = await dataSource.query<{ event_type: string }[]>(
      `SELECT event_type FROM moderation.creator_profile_audit_events
       WHERE investigation_id = $1 ORDER BY created_at`,
      [investigationId],
    );
    expect(eventTypes.map((row) => row.event_type)).toEqual([
      'investigation_opened',
      'report_submitted',
      'username_reset',
      'investigation_closed',
    ]);

    // The released value can never be reused, by this account or any other.
    await dataSource.query('INSERT INTO auth.registered_accounts (id) VALUES ($1)', [randomUUID()]);
    await expect(
      dataSource.query(
        `INSERT INTO moderation.creator_profiles (id, account_id, username, display_name)
         VALUES ($1, $2, $3, 'Someone Else')`,
        [randomUUID(), randomUUID(), violatingUsername],
      ),
    ).rejects.toThrow();
  });

  it('rejects resetting the username of an investigation that is not open', async () => {
    const { profileId } = await seedProfile(`prof_${randomUUID().slice(0, 8).replace(/-/g, '')}`);
    const investigationId = await openInvestigation(profileId);
    const operatorId = await seedOperator();
    await service.resetUsername(operatorId, investigationId, 'first reset');
    await expect(
      service.resetUsername(operatorId, investigationId, 'second reset'),
    ).rejects.toMatchObject({ status: 409 });
  });
});
