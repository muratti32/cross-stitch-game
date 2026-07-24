import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { OperatorAuditLogService } from '../src/admin/operator-audit-log.service';
import { PostPublicationReviewService } from '../src/admin/post-publication-review.service';
import { EmailOutboxDispatcherService } from '../src/auth/email-outbox-dispatcher.service';
import { LocalEmailSender } from '../src/auth/local-email-sender';
import { PrincipalType } from '../src/auth/entities';
import { CatalogMetadataRevisionService } from '../src/catalog/catalog-metadata-revision.service';
import { CatalogPrecheckService } from '../src/catalog/catalog-precheck.service';
import { CommunityReportService } from '../src/catalog/community-report.service';
import { ModerationNoticeService } from '../src/catalog/moderation-notice.service';
import { PatternEntity } from '../src/catalog/entities';
import type { ObjectStorage } from '../src/catalog/storage/object-storage.interface';
import type { AppConfigService } from '../src/config/app-config.service';
import { createTypeOrmOptions } from '../src/database/typeorm-options';
import type { CoinLedgerRepository } from '../src/economy/coin-ledger.repository';
import {
  SessionProgressFlagEntity,
  StitchingSessionEntity,
} from '../src/sessions/entities';
import { SessionsService } from '../src/sessions/sessions.service';

describe('Post-Publication Review Hold', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let reports: CommunityReportService;
  let reviews: PostPublicationReviewService;
  let notices: ModerationNoticeService;
  let revisions: CatalogMetadataRevisionService;
  let sessions: SessionsService;
  let emailDispatcher: EmailOutboxDispatcherService;
  let localEmailSender: LocalEmailSender;
  let ownerAccountId: string;
  let reporterAccountId: string;
  let existingPlayerAccountId: string;
  let newPlayerAccountId: string;
  let operatorId: string;
  let profileId: string;

  const storage: ObjectStorage = {
    delete: () => Promise.resolve(),
    exists: () => Promise.resolve(false),
    get: () => Promise.resolve(null),
    publicUrl: (key: string) => `/v1/catalog-previews/${key}`,
    put: () => Promise.resolve(),
  };

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource(createTypeOrmOptions(postgres.getConnectionUri()));
    await dataSource.initialize();
    await dataSource.runMigrations();

    ownerAccountId = randomUUID();
    reporterAccountId = randomUUID();
    existingPlayerAccountId = randomUUID();
    newPlayerAccountId = randomUUID();
    operatorId = randomUUID();
    profileId = randomUUID();
    await dataSource.query(
      'INSERT INTO auth.registered_accounts (id) VALUES ($1), ($2), ($3), ($4)',
      [
        ownerAccountId,
        reporterAccountId,
        existingPlayerAccountId,
        newPlayerAccountId,
      ],
    );
    await dataSource.query(
      `INSERT INTO auth.auth_identities
        (account_id, provider, email, subject)
       VALUES ($1, 'email', 'review-owner@example.test', 'review-owner@example.test')`,
      [ownerAccountId],
    );
    await dataSource.query(
      `INSERT INTO admin.operator_accounts
        (id, email, password_hash, totp_secret_encrypted)
       VALUES ($1, 'review-moderator@example.test', 'hash', 'ciphertext')`,
      [operatorId],
    );
    await dataSource.query(
      `INSERT INTO moderation.creator_profiles
        (id, account_id, username, display_name)
       VALUES ($1, $2, 'review_hold_owner', 'Review Hold Owner')`,
      [profileId, ownerAccountId],
    );

    reports = new CommunityReportService(dataSource);
    reviews = new PostPublicationReviewService(
      dataSource,
      storage,
      new OperatorAuditLogService(),
    );
    notices = new ModerationNoticeService(dataSource);
    const precheck = new CatalogPrecheckService(
      { openAiModerationEnabled: false } as AppConfigService,
      dataSource,
      storage,
    );
    revisions = new CatalogMetadataRevisionService(dataSource, precheck);
    sessions = new SessionsService(
      dataSource.getRepository(StitchingSessionEntity),
      dataSource.getRepository(SessionProgressFlagEntity),
      dataSource.getRepository(PatternEntity),
      {
        grantSigningSecret: 'review-hold-test-secret',
        grantTtlSeconds: 300,
      } as AppConfigService,
      dataSource,
      {
        isPatternUnlocked: jest.fn().mockResolvedValue(true),
      } as unknown as CoinLedgerRepository,
    );
    localEmailSender = new LocalEmailSender();
    emailDispatcher = new EmailOutboxDispatcherService(
      dataSource,
      localEmailSender,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized === true) await dataSource.destroy();
    if (postgres !== undefined) await postgres.stop();
  });

  it('keeps report intake non-enforcing and exposes reporter-safe structured evidence', async () => {
    const patternId = await createCommunityPattern('Evidence Pattern');
    const first = await reports.create(accountPrincipal(reporterAccountId), patternId, {
      explanation: 'The title appears to describe a different design.',
      reason: 'misleading_title_or_tags',
    });
    await reports.create(accountPrincipal(existingPlayerAccountId), patternId, {
      reason: 'copyright_or_publication_rights',
    });

    expect(await patternStatus(patternId)).toBe('available');
    expect(await countRows('moderation.moderation_notices')).toBe(0);
    expect(await countRows('admin.operator_audit_log')).toBe(0);

    const queue = await reviews.listOpen();
    expect(queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.review.id,
          patternId,
          patternStatus: 'available',
          reportCount: 2,
        }),
      ]),
    );
    const detail = await reviews.get(first.review.id);
    expect(detail).toMatchObject({
      pattern: { id: patternId, status: 'available', title: 'Evidence Pattern' },
      reports: [
        expect.objectContaining({ reason: 'misleading_title_or_tags' }),
        expect.objectContaining({ reason: 'copyright_or_publication_rights' }),
      ],
    });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain(reporterAccountId);
    expect(serialized).not.toContain(existingPlayerAccountId);
    expect(serialized).not.toContain('reporterAccountId');
  });

  it('applies one atomic human Review Hold, notice, audit, and idempotent email', async () => {
    const patternId = await createCommunityPattern('Held Pattern');
    const created = await reports.create(
      accountPrincipal(reporterAccountId),
      patternId,
      { reason: 'inappropriate_or_unsafe_content' },
    );
    const reason = 'A moderator is reviewing a reported catalog safety concern.';

    await expect(
      reviews.applyHold(randomUUID(), created.review.id, reason, 'failed-request'),
    ).rejects.toThrow();
    expect(await patternStatus(patternId)).toBe('available');
    expect(await noticeCount(created.review.id)).toBe(0);

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        reviews.applyHold(operatorId, created.review.id, reason, 'request-50'),
      ),
    );
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    expect(new Set(results.map((result) => result.moderationNoticeId))).toHaveProperty(
      'size',
      1,
    );
    expect(await patternStatus(patternId)).toBe('review_hold');
    expect(await noticeCount(created.review.id)).toBe(1);

    const [auditCount, outboxCount] = await Promise.all([
      countRows(
        'admin.operator_audit_log',
        `action = 'post_publication_review.hold.apply' AND target_id = '${created.review.id}'`,
      ),
      countRows(
        'notifications.email_outbox',
        `dedupe_key = 'moderation_notice:${results[0].moderationNoticeId}'`,
      ),
    ]);
    expect(auditCount).toBe(1);
    expect(outboxCount).toBe(1);

    const ownerNotices = await notices.listMine(accountPrincipal(ownerAccountId));
    expect(ownerNotices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patternId,
          patternTitle: 'Held Pattern',
          reason,
        }),
      ]),
    );
    expect(JSON.stringify(ownerNotices)).not.toContain(reporterAccountId);
    await expect(notices.listMine(guestPrincipal())).rejects.toMatchObject({
      status: 403,
    });

    await expect(emailDispatcher.dispatchOnce()).resolves.toBe(1);
    await expect(emailDispatcher.dispatchOnce()).resolves.toBe(0);
    expect(localEmailSender.getModerationNoticeDeliveries()).toEqual([
      expect.objectContaining({
        deliveryId: `moderation_notice:${results[0].moderationNoticeId}`,
        noticeId: results[0].moderationNoticeId,
        patternId,
        patternTitle: 'Held Pattern',
        reason,
        toEmail: 'review-owner@example.test',
      }),
    ]);
  });

  it('blocks new sessions while preserving existing progress and grant eligibility', async () => {
    const patternId = await createCommunityPattern('Session Hold Pattern');
    const prepared = await sessions.prepareSession(
      accountPrincipal(existingPlayerAccountId),
      patternId,
    );
    await sessions.setProgressFlagInternal(prepared.sessionId, true);
    const created = await reports.create(
      accountPrincipal(reporterAccountId),
      patternId,
      { reason: 'duplicate_or_spam' },
    );
    await reviews.applyHold(
      operatorId,
      created.review.id,
      'The Pattern is held while duplicate evidence is reviewed.',
      null,
    );

    await expect(
      sessions.prepareSession(accountPrincipal(newPlayerAccountId), patternId),
    ).rejects.toThrow('Pattern is not available');
    const resumed = await sessions.prepareSession(
      accountPrincipal(existingPlayerAccountId),
      patternId,
    );
    const refreshed = await sessions.refreshGrant(
      accountPrincipal(existingPlayerAccountId),
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

  it('allows owner metadata correction during Review Hold without restoring discovery', async () => {
    const patternId = await createCommunityPattern('Metadata Hold Pattern');
    const created = await reports.create(
      accountPrincipal(reporterAccountId),
      patternId,
      { reason: 'misleading_title_or_tags' },
    );
    await reviews.applyHold(
      operatorId,
      created.review.id,
      'The catalog metadata needs contextual human review.',
      null,
    );

    const revision = await revisions.create(accountPrincipal(ownerAccountId), patternId, {
      categoryCode: 'other',
      description: 'A corrected description for the held Community Pattern.',
      sourceLanguage: 'en',
      tagCodes: [],
      title: 'Corrected Metadata Hold Pattern',
    });
    expect(revision.status).toBe('pending');
    expect(await patternStatus(patternId)).toBe('review_hold');
    const owned = await revisions.myPatterns(accountPrincipal(ownerAccountId));
    expect(owned).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: patternId, status: 'review_hold' }),
      ]),
    );
  });

  function accountPrincipal(id: string) {
    return { id, tokenVersion: 1, type: PrincipalType.Account };
  }

  function guestPrincipal() {
    return { id: randomUUID(), tokenVersion: 1, type: PrincipalType.Guest };
  }

  async function createCommunityPattern(title: string): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO catalog.patterns
        (id, title, description, creator_name, creator_profile_id, category_code,
         width, height, palette_size, artifact_object_key, artifact_checksum,
         artifact_byte_length, artifact_schema_version, preview_object_key,
         visibility, owner_account_id, status)
       VALUES ($1, $2, 'A Review Hold fixture.', 'Review Hold Owner', $3, 'other',
         2, 2, 2, $4, $5, 100, 1, $6, 'catalog', NULL, 'available')`,
      [
        id,
        title,
        profileId,
        `community/${id}/artifact.bin`,
        'a'.repeat(64),
        `community/${id}/preview.png`,
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

  async function noticeCount(reviewId: string): Promise<number> {
    const [row] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*) FROM moderation.moderation_notices WHERE review_id = $1',
      [reviewId],
    );
    return Number.parseInt(row.count, 10);
  }

  async function countRows(table: string, predicate?: string): Promise<number> {
    const [row] = await dataSource.query<{ count: string }[]>(
      `SELECT count(*) FROM ${table}${predicate === undefined ? '' : ` WHERE ${predicate}`}`,
    );
    return Number.parseInt(row.count, 10);
  }
});
