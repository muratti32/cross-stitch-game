import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { AdminCatalogService } from '../src/admin/admin-catalog.service';
import { OperatorAuditLogService } from '../src/admin/operator-audit-log.service';
import { PrincipalType } from '../src/auth/entities';
import { CatalogMetadataRevisionService } from '../src/catalog/catalog-metadata-revision.service';
import { CatalogPrecheckService } from '../src/catalog/catalog-precheck.service';
import { CatalogWithdrawalService } from '../src/catalog/catalog-withdrawal.service';
import {
  CategoryEntity,
  PatternEntity,
  StaffPickEntity,
  TagEntity,
  TagLabelEntity,
} from '../src/catalog/entities';
import type { ObjectStorage } from '../src/catalog/storage/object-storage.interface';
import type { AppConfigService } from '../src/config/app-config.service';
import { createTypeOrmOptions } from '../src/database/typeorm-options';
import type { CoinLedgerRepository } from '../src/economy/coin-ledger.repository';
import { SessionProgressFlagEntity, StitchingSessionEntity } from '../src/sessions/entities';
import { SessionsService } from '../src/sessions/sessions.service';

describe('Catalog Withdrawal', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let withdrawals: CatalogWithdrawalService;
  let sessions: SessionsService;
  let revisions: CatalogMetadataRevisionService;
  let adminCatalog: AdminCatalogService;
  let ownerAccountId: string;
  let playerAccountId: string;
  let operatorId: string;
  let profileId: string;

  const storage: ObjectStorage = {
    delete: () => Promise.resolve(),
    exists: () => Promise.resolve(false),
    get: () => Promise.resolve(null),
    list: () => Promise.resolve([]),
    publicUrl: (key: string) => key,
    put: () => Promise.resolve(),
  };

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource(createTypeOrmOptions(postgres.getConnectionUri()));
    await dataSource.initialize();
    await dataSource.runMigrations();

    ownerAccountId = randomUUID();
    playerAccountId = randomUUID();
    operatorId = randomUUID();
    profileId = randomUUID();
    await dataSource.query(
      'INSERT INTO auth.registered_accounts (id) VALUES ($1), ($2)',
      [ownerAccountId, playerAccountId],
    );
    await dataSource.query(
      `INSERT INTO admin.operator_accounts
        (id, email, password_hash, totp_secret_encrypted)
       VALUES ($1, 'withdrawal-reviewer@example.test', 'hash', 'ciphertext')`,
      [operatorId],
    );
    await dataSource.query(
      `INSERT INTO moderation.creator_profiles
        (id, account_id, username, display_name)
       VALUES ($1, $2, 'withdrawal_owner', 'Withdrawal Owner')`,
      [profileId, ownerAccountId],
    );

    withdrawals = new CatalogWithdrawalService(dataSource);
    sessions = new SessionsService(
      dataSource.getRepository(StitchingSessionEntity),
      dataSource.getRepository(SessionProgressFlagEntity),
      dataSource.getRepository(PatternEntity),
      {
        grantSigningSecret: 'catalog-withdrawal-test-secret',
        grantTtlSeconds: 300,
      } as AppConfigService,
      dataSource,
      { isPatternUnlocked: jest.fn().mockResolvedValue(true) } as unknown as CoinLedgerRepository,
    );
    const precheck = new CatalogPrecheckService(
      { openAiModerationEnabled: false } as AppConfigService,
      dataSource,
      storage,
    );
    revisions = new CatalogMetadataRevisionService(dataSource, precheck, storage);
    adminCatalog = new AdminCatalogService(
      dataSource,
      storage,
      new OperatorAuditLogService(),
      dataSource.getRepository(PatternEntity),
      dataSource.getRepository(TagEntity),
      dataSource.getRepository(TagLabelEntity),
      dataSource.getRepository(StaffPickEntity),
      dataSource.getRepository(CategoryEntity),
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized === true) await dataSource.destroy();
    if (postgres !== undefined) await postgres.stop();
  });

  it('allows only the owning Registered Account to withdraw a Community Pattern', async () => {
    const communityPatternId = await createPattern(profileId);
    const officialPatternId = await createPattern(null);

    await expect(
      withdrawals.withdraw(guestPrincipal(), communityPatternId),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      withdrawals.withdraw(accountPrincipal(playerAccountId), communityPatternId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      withdrawals.withdraw(accountPrincipal(), officialPatternId),
    ).rejects.toMatchObject({ status: 404 });

    expect(await patternStatus(communityPatternId)).toBe('available');
    expect(await patternStatus(officialPatternId)).toBe('available');
  });

  it('rolls back Pattern and Staff Pick mutations when bulk-removal audit persistence fails', async () => {
    const patternId = await createPattern(null);
    await dataSource.getRepository(StaffPickEntity).save({ patternId, position: 1 });

    await expect(adminCatalog.bulkRemovePatterns(
      randomUUID(),
      [patternId],
      'Confirmed rollback evidence',
      randomUUID(),
      'bulk-rollback-request',
    )).rejects.toThrow();

    expect(await patternStatus(patternId)).toBe('available');
    await expect(dataSource.getRepository(StaffPickEntity).findOneBy({ patternId }))
      .resolves.toMatchObject({ patternId, position: 1 });
    const [{ count }] = await dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count
       FROM admin.operator_audit_log
       WHERE request_id = 'bulk-rollback-request'`,
    );
    expect(count).toBe('0');
  });

  it('serializes concurrent retries and preserves the first successful bulk-removal result', async () => {
    const firstId = await createPattern(null);
    const secondId = await createPattern(null);
    const batchId = randomUUID();
    const invoke = () => adminCatalog.bulkRemovePatterns(
      operatorId,
      [secondId, firstId],
      '  Confirmed concurrent removal  ',
      batchId,
      randomUUID(),
    );

    const [first, retry] = await Promise.all([invoke(), invoke()]);

    expect(retry).toEqual(first);
    expect(first).toEqual({
      batchId,
      patternIds: [firstId, secondId].sort(),
      removedCount: 2,
    });
    const [{ auditCount, receiptCount }] = await dataSource.query<
      { auditCount: string; receiptCount: string }[]
    >(
      `SELECT
        (SELECT COUNT(*)::text FROM admin.operator_audit_log
         WHERE action = 'pattern.bulk_remove' AND after->>'batchId' = $1) AS "auditCount",
        (SELECT COUNT(*)::text FROM admin.bulk_pattern_removals
         WHERE operator_account_id = $2::uuid AND batch_id = $1::uuid) AS "receiptCount"`,
      [batchId, operatorId],
    );
    expect({ auditCount, receiptCount }).toEqual({ auditCount: '2', receiptCount: '1' });
  });

  it('rejects a persisted batch payload mismatch without mutating the new selection', async () => {
    const removedId = await createPattern(null);
    const untouchedId = await createPattern(null);
    const batchId = randomUUID();
    await adminCatalog.bulkRemovePatterns(
      operatorId, [removedId], 'Confirmed persisted removal', batchId, randomUUID(),
    );

    await expect(adminCatalog.bulkRemovePatterns(
      operatorId, [untouchedId], 'Confirmed persisted removal', batchId, randomUUID(),
    )).rejects.toThrow('batch ID was already used with a different request');
    await expect(adminCatalog.bulkRemovePatterns(
      operatorId, [removedId], 'Confirmed different reason', batchId, randomUUID(),
    )).rejects.toThrow('batch ID was already used with a different request');

    expect(await patternStatus(untouchedId)).toBe('available');
    const [{ count }] = await dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM admin.operator_audit_log
       WHERE action = 'pattern.bulk_remove' AND after->>'batchId' = $1`,
      [batchId],
    );
    expect(count).toBe('1');
  });

  it('closes pending revisions and active appeals without publication and audits every transition', async () => {
    const pendingPatternId = await createPattern(profileId);
    const pendingRevisionId = await createRevision(pendingPatternId, 'pending');
    const pendingResult = await withdrawals.withdraw(
      accountPrincipal(),
      pendingPatternId,
    );
    expect(pendingResult).toMatchObject({
      created: true,
      withdrawal: {
        closedRecords: [
          {
            fromStatus: 'pending',
            recordId: pendingRevisionId,
            recordType: 'metadata_revision',
            toStatus: 'withdrawn',
          },
        ],
        status: 'withdrawn',
      },
    });

    const appealPatternId = await createPattern(profileId);
    const appealRevisionId = await createRevision(appealPatternId, 'appeal_pending');
    const [{ id: appealId }] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO catalog.catalog_metadata_appeals (revision_id, account_id, note)
       VALUES ($1, $2, 'Please reconsider') RETURNING id`,
      [appealRevisionId, ownerAccountId],
    );
    const appealResult = await withdrawals.withdraw(accountPrincipal(), appealPatternId);
    expect(appealResult.withdrawal.closedRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromStatus: 'appeal_pending',
          recordId: appealRevisionId,
          recordType: 'metadata_revision',
          toStatus: 'withdrawn',
        }),
        expect.objectContaining({
          fromStatus: 'open',
          recordId: appealId,
          recordType: 'metadata_appeal',
          toStatus: 'closed_without_publication',
        }),
      ]),
    );

    const rows = await dataSource.query<
      { id: string; status: string; title: string }[]
    >(
      `SELECT revision.id, revision.status, pattern.title
       FROM catalog.catalog_metadata_revisions revision
       JOIN catalog.patterns pattern ON pattern.id = revision.community_pattern_id
       WHERE revision.id IN ($1, $2)
       ORDER BY revision.id`,
      [pendingRevisionId, appealRevisionId],
    );
    expect(rows.map((row) => row.status)).toEqual(['withdrawn', 'withdrawn']);
    expect(rows.map((row) => row.title)).toEqual([
      'Withdrawal Pattern',
      'Withdrawal Pattern',
    ]);

    const rejectedPatternId = await createPattern(profileId);
    const rejectedRevisionId = await createRevision(rejectedPatternId, 'rejected');
    await withdrawals.withdraw(accountPrincipal(), rejectedPatternId);
    await expect(
      revisions.appeal(accountPrincipal(), rejectedRevisionId, { note: 'Try again' }),
    ).rejects.toThrow('Community Pattern is unavailable');
  });

  it('blocks new sessions while preserving existing sessions, progress, and artifact grants', async () => {
    const patternId = await createPattern(profileId);
    const prepared = await sessions.prepareSession(
      accountPrincipal(playerAccountId),
      patternId,
    );
    await sessions.setProgressFlagInternal(prepared.sessionId, true);

    await withdrawals.withdraw(accountPrincipal(), patternId);

    await expect(
      sessions.prepareSession(accountPrincipal(), patternId),
    ).rejects.toThrow('Pattern is not available');
    const resumed = await sessions.prepareSession(
      accountPrincipal(playerAccountId),
      patternId,
    );
    const refreshed = await sessions.refreshGrant(
      accountPrincipal(playerAccountId),
      prepared.sessionId,
    );
    expect(resumed.sessionId).toBe(prepared.sessionId);
    expect(refreshed.grant.url).toContain(`/v1/artifacts/${patternId}`);

    const [flag] = await dataSource.query<{ has_any_progress: boolean }[]>(
      'SELECT has_any_progress FROM sessions.session_progress_flags WHERE session_id = $1',
      [prepared.sessionId],
    );
    expect(flag.has_any_progress).toBe(true);
  });

  it('is idempotent and irreversible while leaving Official Pattern operator controls intact', async () => {
    const communityPatternId = await createPattern(profileId);
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () =>
        withdrawals.withdraw(accountPrincipal(), communityPatternId),
      ),
    );
    expect(concurrent.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(concurrent.map((result) => result.withdrawal.id))).toHaveProperty(
      'size',
      1,
    );
    const first = concurrent.find((result) => result.created)!;
    const repeat = await withdrawals.withdraw(accountPrincipal(), communityPatternId);
    expect(first.created).toBe(true);
    expect(repeat).toMatchObject({
      created: false,
      withdrawal: { id: first.withdrawal.id, status: 'withdrawn' },
    });

    await expect(
      dataSource.query(
        `UPDATE catalog.patterns SET status = 'available' WHERE id = $1`,
        [communityPatternId],
      ),
    ).rejects.toThrow('Catalog Withdrawal is irreversible');
    await expect(
      dataSource.query(
        `UPDATE catalog.catalog_withdrawals SET previous_status = 'withdrawn' WHERE id = $1`,
        [first.withdrawal.id],
      ),
    ).rejects.toThrow('Catalog Withdrawal history is append-only');
    await expect(
      adminCatalog.restorePattern(operatorId, communityPatternId, null),
    ).rejects.toThrow('Catalog Withdrawal is irreversible');

    const officialPatternId = await createPattern(null);
    await expect(
      adminCatalog.withdrawPattern(operatorId, officialPatternId, null),
    ).resolves.toMatchObject({ status: 'withdrawn' });
    await expect(
      adminCatalog.restorePattern(operatorId, officialPatternId, null),
    ).resolves.toMatchObject({ status: 'available' });
  });

  function accountPrincipal(id = ownerAccountId) {
    return { id, tokenVersion: 1, type: PrincipalType.Account };
  }

  function guestPrincipal() {
    return { id: randomUUID(), tokenVersion: 1, type: PrincipalType.Guest };
  }

  async function createPattern(creatorProfileId: string | null): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO catalog.patterns
        (id, title, description, creator_name, creator_profile_id, category_code, width, height,
         palette_size, artifact_object_key, artifact_checksum, artifact_byte_length,
         artifact_schema_version, preview_object_key, visibility, owner_account_id, status)
       VALUES ($1, 'Withdrawal Pattern', 'Original description.', 'Withdrawal Owner', $2,
         'other', 2, 2, 2, $3, $4, 100, 1, $5, 'catalog', NULL, 'available')`,
      [
        id,
        creatorProfileId,
        `withdrawal/${id}/artifact.bin`,
        'a'.repeat(64),
        `withdrawal/${id}/preview.png`,
      ],
    );
    return id;
  }

  async function createRevision(
    patternId: string,
    status: 'appeal_pending' | 'pending' | 'rejected',
  ): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO catalog.catalog_metadata_revisions
        (id, account_id, creator_profile_id, community_pattern_id, title, description,
         source_language, category_code, tag_codes, status)
       VALUES ($1, $2, $3, $4, 'Unpublished Revision', 'Unpublished description.',
         'en', 'other', '{}', $5)`,
      [id, ownerAccountId, profileId, patternId, status],
    );
    return id;
  }

  async function patternStatus(patternId: string): Promise<string> {
    const [{ status }] = await dataSource.query<{ status: string }[]>(
      'SELECT status FROM catalog.patterns WHERE id = $1',
      [patternId],
    );
    return status;
  }
});
