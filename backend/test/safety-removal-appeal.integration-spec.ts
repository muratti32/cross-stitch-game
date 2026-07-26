import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { OperatorAuditLogService } from '../src/admin/operator-audit-log.service';
import { PostPublicationReviewService } from '../src/admin/post-publication-review.service';
import { EmailOutboxDispatcherService } from '../src/auth/email-outbox-dispatcher.service';
import { LocalEmailSender } from '../src/auth/local-email-sender';
import { PrincipalType } from '../src/auth/entities';
import { CommunityReportService } from '../src/catalog/community-report.service';
import { ModerationNoticeService } from '../src/catalog/moderation-notice.service';
import { SafetyRemovalAppealService } from '../src/catalog/safety-removal-appeal.service';
import { PatternEntity } from '../src/catalog/entities';
import type { ObjectStorage } from '../src/catalog/storage/object-storage.interface';
import { createTypeOrmOptions } from '../src/database/typeorm-options';
import type { CoinLedgerRepository } from '../src/economy/coin-ledger.repository';
import { SessionProgressFlagEntity, StitchingSessionEntity } from '../src/sessions/entities';
import { SessionsService } from '../src/sessions/sessions.service';
import type { AppConfigService } from '../src/config/app-config.service';

describe('Safety Removal Appeal', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let reports: CommunityReportService;
  let reviews: PostPublicationReviewService;
  let appeals: SafetyRemovalAppealService;
  let notices: ModerationNoticeService;
  let sessions: SessionsService;
  let emailDispatcher: EmailOutboxDispatcherService;
  let localEmailSender: LocalEmailSender;
  let ownerAccountId: string;
  let reporterAccountId: string;
  let existingPlayerAccountId: string;
  let operatorId: string;
  let secondOperatorId: string;
  let profileId: string;

  const archive = new Map<string, Buffer>();
  const storage: ObjectStorage = {
    delete: (key: string) => {
      archive.delete(key);
      return Promise.resolve();
    },
    exists: () => Promise.resolve(false),
    get: (key: string) => Promise.resolve(archive.get(key) ?? null),
    list: () => Promise.resolve([...archive.keys()]),
    publicUrl: (key: string) => `/v1/catalog-previews/${key}`,
    put: (key: string, data: Buffer) => {
      archive.set(key, data);
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource(createTypeOrmOptions(postgres.getConnectionUri()));
    await dataSource.initialize();
    await dataSource.runMigrations();

    ownerAccountId = randomUUID();
    reporterAccountId = randomUUID();
    existingPlayerAccountId = randomUUID();
    operatorId = randomUUID();
    secondOperatorId = randomUUID();
    profileId = randomUUID();
    await dataSource.query(
      'INSERT INTO auth.registered_accounts (id) VALUES ($1), ($2), ($3)',
      [ownerAccountId, reporterAccountId, existingPlayerAccountId],
    );
    await dataSource.query(
      `INSERT INTO auth.auth_identities
        (account_id, provider, email, subject)
       VALUES ($1, 'email', 'appeal-owner@example.test', 'appeal-owner@example.test')`,
      [ownerAccountId],
    );
    await dataSource.query(
      `INSERT INTO admin.operator_accounts
        (id, email, password_hash, totp_secret_encrypted)
       VALUES ($1, 'appeal-moderator@example.test', 'hash', 'ciphertext')`,
      [operatorId],
    );
    await dataSource.query(
      `INSERT INTO moderation.creator_profiles
        (id, account_id, username, display_name)
       VALUES ($1, $2, 'appeal_owner', 'Appeal Owner')`,
      [profileId, ownerAccountId],
    );

    reports = new CommunityReportService(dataSource);
    reviews = new PostPublicationReviewService(
      dataSource,
      storage,
      new OperatorAuditLogService(),
    );
    appeals = new SafetyRemovalAppealService(
      dataSource,
      storage,
      new OperatorAuditLogService(),
    );
    notices = new ModerationNoticeService(dataSource);
    sessions = new SessionsService(
      dataSource.getRepository(StitchingSessionEntity),
      dataSource.getRepository(SessionProgressFlagEntity),
      dataSource.getRepository(PatternEntity),
      {
        grantSigningSecret: 'safety-removal-appeal-test-secret',
        grantTtlSeconds: 300,
      } as AppConfigService,
      dataSource,
      {
        isPatternUnlocked: jest.fn().mockResolvedValue(true),
      } as unknown as CoinLedgerRepository,
    );
    localEmailSender = new LocalEmailSender();
    emailDispatcher = new EmailOutboxDispatcherService(dataSource, localEmailSender);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized === true) await dataSource.destroy();
    if (postgres !== undefined) await postgres.stop();
  });

  async function removePattern(title: string) {
    const patternId = await createCommunityPattern(title);
    const prepared = await sessions.prepareSession(
      accountPrincipal(existingPlayerAccountId),
      patternId,
    );
    const created = await reports.create(accountPrincipal(reporterAccountId), patternId, {
      reason: 'inappropriate_or_unsafe_content',
    });
    await reviews.applySafetyRemoval(
      operatorId,
      created.review.id,
      'Confirmed unsafe content violating platform policy.',
      null,
    );
    return { patternId, sessionId: prepared.sessionId };
  }

  it('rejects appeal creation by a non-owner and before the Pattern is under Safety Removal', async () => {
    const patternId = await createCommunityPattern('Not Yet Removed');
    await expect(
      appeals.create(accountPrincipal(ownerAccountId), patternId, {}),
    ).rejects.toThrow('Only a safety-removed Community Pattern can be appealed');

    const { patternId: removedId } = await removePattern('Owner Mismatch');
    await expect(
      appeals.create(accountPrincipal(reporterAccountId), removedId, {}),
    ).rejects.toThrow('Community Pattern not found');
  });

  it('allows exactly one appeal per Safety Removal decision', async () => {
    const { patternId } = await removePattern('Single Appeal Pattern');
    const created = await appeals.create(accountPrincipal(ownerAccountId), patternId, {
      note: 'This design does not violate policy.',
    });
    expect(created.status).toBe('open');

    await expect(
      appeals.create(accountPrincipal(ownerAccountId), patternId, {}),
    ).rejects.toThrow('This Safety Removal decision has already used its appeal');
  });

  it('keeps Safety Removal fully effective while the appeal is open', async () => {
    const { patternId, sessionId } = await removePattern('Open Appeal Pattern');
    await appeals.create(accountPrincipal(ownerAccountId), patternId, {});

    expect(await patternStatus(patternId)).toBe('removed');
    await expect(
      sessions.refreshGrant(accountPrincipal(existingPlayerAccountId), sessionId),
    ).rejects.toThrow('Pattern is not available');
  });

  it('accepts the appeal: restores discovery, republishes the preview, and lets existing sessions download again', async () => {
    const { patternId, sessionId } = await removePattern('Restored Pattern');
    const [before] = await dataSource.query<{ preview_object_key: string }[]>(
      'SELECT preview_object_key FROM catalog.patterns WHERE id = $1',
      [patternId],
    );
    expect(archive.has(archiveKeyFor(patternId, before.preview_object_key))).toBe(true);
    expect(archive.has(before.preview_object_key)).toBe(false);

    const created = await appeals.create(accountPrincipal(ownerAccountId), patternId, {});
    const reason = 'A second review found no policy violation.';
    const results = await Promise.all(
      Array.from({ length: 4 }, () => appeals.accept(operatorId, created.id, reason, 'accept-request')),
    );
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    expect(new Set(results.map((result) => result.moderationNoticeId))).toHaveProperty('size', 1);
    expect(results[0].status).toBe('accepted');
    expect(results[0].sameModeratorFallback).toBe(true);

    expect(await patternStatus(patternId)).toBe('available');
    expect(archive.has(before.preview_object_key)).toBe(true);
    expect(archive.has(archiveKeyFor(patternId, before.preview_object_key))).toBe(false);

    const refreshed = await sessions.refreshGrant(
      accountPrincipal(existingPlayerAccountId),
      sessionId,
    );
    expect(refreshed.grant.url).toContain(`/v1/artifacts/${patternId}`);

    const ownerNotices = await notices.listMine(accountPrincipal(ownerAccountId));
    expect(ownerNotices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          noticeType: 'safety_removal_appeal_accepted',
          patternId,
          reason,
        }),
      ]),
    );
    expect(JSON.stringify(ownerNotices)).not.toContain(reporterAccountId);

    await expect(emailDispatcher.dispatchOnce()).resolves.toBeGreaterThan(0);
    expect(localEmailSender.getModerationNoticeDeliveries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deliveryId: `moderation_notice:${results[0].moderationNoticeId}`,
          reason,
        }),
      ]),
    );

    await expect(
      appeals.reject(operatorId, created.id, 'Too late.', null),
    ).rejects.toThrow('Safety Removal Appeal is already closed');
  });

  it('rejects the appeal: leaves Safety Removal final and records the decision', async () => {
    const { patternId, sessionId } = await removePattern('Upheld Removal Pattern');
    const created = await appeals.create(accountPrincipal(ownerAccountId), patternId, {});
    const reason = 'The original Safety Removal decision is confirmed on review.';
    const results = await Promise.all(
      Array.from({ length: 4 }, () => appeals.reject(operatorId, created.id, reason, 'reject-request')),
    );
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    expect(results[0].status).toBe('rejected');

    expect(await patternStatus(patternId)).toBe('removed');
    await expect(
      sessions.refreshGrant(accountPrincipal(existingPlayerAccountId), sessionId),
    ).rejects.toThrow('Pattern is not available');

    const ownerNotices = await notices.listMine(accountPrincipal(ownerAccountId));
    expect(ownerNotices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          noticeType: 'safety_removal_appeal_rejected',
          patternId,
          reason,
        }),
      ]),
    );

    await expect(
      appeals.accept(operatorId, created.id, 'Too late.', null),
    ).rejects.toThrow('Safety Removal Appeal is already closed');
  });

  it('assigns review to a different moderator when one is eligible, and audits the fallback otherwise', async () => {
    // This operator account is intentionally left in place for the rest of
    // the suite: deleting it would violate the FK from any appeal decision
    // it resolves (ON DELETE RESTRICT), and the test container is torn down
    // in afterAll regardless.
    await dataSource.query(
      `INSERT INTO admin.operator_accounts
        (id, email, password_hash, totp_secret_encrypted)
       VALUES ($1, 'appeal-second-moderator@example.test', 'hash', 'ciphertext')`,
      [secondOperatorId],
    );

    const { patternId } = await removePattern('Reassigned Moderator Pattern');
    const created = await appeals.create(accountPrincipal(ownerAccountId), patternId, {});

    await expect(
      appeals.accept(operatorId, created.id, 'Same moderator retrying while another exists.', null),
    ).rejects.toThrow('Safety Removal Appeal must be assigned to a different moderator');

    const result = await appeals.accept(
      secondOperatorId,
      created.id,
      'A different moderator confirms no violation.',
      null,
    );
    expect(result.status).toBe('accepted');
    expect(result.sameModeratorFallback).toBe(false);
  });

  function accountPrincipal(id: string) {
    return { id, tokenVersion: 1, type: PrincipalType.Account };
  }

  function archiveKeyFor(patternId: string, previewObjectKey: string): string {
    const dotIndex = previewObjectKey.lastIndexOf('.');
    const extension = dotIndex === -1 ? '' : previewObjectKey.slice(dotIndex);
    return `moderation-archive/${patternId}/preview${extension}`;
  }

  async function createCommunityPattern(title: string): Promise<string> {
    const id = randomUUID();
    const previewObjectKey = `community/${id}/preview.png`;
    archive.set(previewObjectKey, Buffer.from(`preview-bytes-${id}`));
    await dataSource.query(
      `INSERT INTO catalog.patterns
        (id, title, description, creator_name, creator_profile_id, category_code,
         width, height, palette_size, artifact_object_key, artifact_checksum,
         artifact_byte_length, artifact_schema_version, preview_object_key,
         visibility, owner_account_id, status)
       VALUES ($1, $2, 'A Safety Removal Appeal fixture.', 'Appeal Owner', $3, 'other',
         2, 2, 2, $4, $5, 100, 1, $6, 'catalog', NULL, 'available')`,
      [
        id,
        title,
        profileId,
        `community/${id}/artifact.bin`,
        'a'.repeat(64),
        previewObjectKey,
      ],
    );
    return id;
  }

  async function patternStatus(patternId: string): Promise<string> {
    const [row] = await dataSource.query<{ status: string }[]>(
      'SELECT status FROM catalog.patterns WHERE id = $1',
      [patternId],
    );
    return row.status;
  }
});
