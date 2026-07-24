import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { PrincipalType } from '../src/auth/entities';
import {
  CreatorProfileAuditEntity,
  CreatorProfileAuditEventEntity,
  CreatorProfileEntity,
  ProfileInvestigationEntity,
  ProfileReportEntity,
} from '../src/creator-profile/entities';
import { ProfileReportService } from '../src/creator-profile/profile-report.service';
import { CreateAuthSchema1783987200000 } from '../src/database/migrations/1783987200000-CreateAuthSchema';
import { CreateEmailAuthSchema1784160000001 } from '../src/database/migrations/1784160000001-CreateEmailAuthSchema';
import { CreateAdminAuthSchema1784592000000 } from '../src/database/migrations/1784592000000-CreateAdminAuthSchema';
import { CreateCreatorProfiles1786060800000 } from '../src/database/migrations/1786060800000-CreateCreatorProfiles';
import { CreateProfileReports1786320000000 } from '../src/database/migrations/1786320000000-CreateProfileReports';

const ACCOUNT = PrincipalType.Account;

describe('Profile Report intake and Profile Investigation', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let service: ProfileReportService;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      entities: [
        CreatorProfileEntity,
        CreatorProfileAuditEntity,
        CreatorProfileAuditEventEntity,
        ProfileInvestigationEntity,
        ProfileReportEntity,
      ],
      migrations: [
        CreateAuthSchema1783987200000,
        CreateEmailAuthSchema1784160000001,
        CreateAdminAuthSchema1784592000000,
        CreateCreatorProfiles1786060800000,
        CreateProfileReports1786320000000,
      ],
      migrationsTableName: 'typeorm_migrations',
      synchronize: false,
      type: 'postgres',
      url: postgres.getConnectionUri(),
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    service = new ProfileReportService(dataSource);
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
});
