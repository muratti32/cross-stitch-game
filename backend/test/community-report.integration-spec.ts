import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { PrincipalType } from '../src/auth/entities';
import {
  COMMUNITY_REPORT_REOPEN_COOLDOWN_MS,
  CommunityReportService,
} from '../src/catalog/community-report.service';
import { createTypeOrmOptions } from '../src/database/typeorm-options';

describe('Community Report intake', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let service: CommunityReportService;
  let accountId: string;
  let secondAccountId: string;
  let profileId: string;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource(createTypeOrmOptions(postgres.getConnectionUri()));
    await dataSource.initialize();
    await dataSource.runMigrations();
    service = new CommunityReportService(dataSource);

    accountId = randomUUID();
    secondAccountId = randomUUID();
    profileId = randomUUID();
    await dataSource.query(
      'INSERT INTO auth.registered_accounts (id) VALUES ($1), ($2)',
      [accountId, secondAccountId],
    );
    await dataSource.query(
      `INSERT INTO moderation.creator_profiles
        (id, account_id, username, display_name)
       VALUES ($1, $2, 'report_fixture', 'Report Fixture')`,
      [profileId, accountId],
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (dataSource?.isInitialized === true) await dataSource.destroy();
    if (postgres !== undefined) await postgres.stop();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requires a Registered Account and an explanation for Other', async () => {
    const patternId = await createCommunityPattern();

    await expect(
      service.create(
        { id: randomUUID(), tokenVersion: 1, type: PrincipalType.Guest },
        patternId,
        { reason: 'duplicate_or_spam' },
      ),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      service.create(accountPrincipal(), patternId, { reason: 'other' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.create(accountPrincipal(), patternId, {
        explanation: '!!!',
        reason: 'other',
      }),
    ).rejects.toMatchObject({ status: 400 });

    const counts = await moderationCounts(patternId);
    expect(counts).toEqual({ reports: 0, reviews: 0 });
  });

  it('creates one open review, deduplicates one account, and lets another account contribute', async () => {
    const patternId = await createCommunityPattern();
    const first = await service.create(accountPrincipal(), patternId, {
      explanation: 'The title describes a different design.',
      reason: 'misleading_title_or_tags',
    });
    const duplicate = await service.create(accountPrincipal(), patternId, {
      explanation: 'A later repeat must not replace the first immutable report.',
      reason: 'other',
    });
    const contribution = await service.create(
      accountPrincipal(secondAccountId),
      patternId,
      { reason: 'copyright_or_publication_rights' },
    );

    expect(first.created).toBe(true);
    expect(duplicate).toMatchObject({
      created: false,
      report: { id: first.report.id, reason: 'misleading_title_or_tags' },
      review: { id: first.review.id, status: 'open' },
    });
    expect(contribution).toMatchObject({
      created: true,
      review: { id: first.review.id },
    });
    expect(await moderationCounts(patternId)).toEqual({ reports: 2, reviews: 1 });

    const [pattern] = await dataSource.query<
      { status: string; title: string; visibility: string }[]
    >(
      `SELECT title, status, visibility FROM catalog.patterns WHERE id = $1`,
      [patternId],
    );
    expect(pattern).toEqual({
      status: 'available',
      title: 'Reportable Pattern',
      visibility: 'catalog',
    });
  });

  it('collapses concurrent retries into one report and one review', async () => {
    const patternId = await createCommunityPattern();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        service.create(accountPrincipal(), patternId, {
          explanation: 'The same report was retried while the request was in flight.',
          reason: 'duplicate_or_spam',
        }),
      ),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.report.id))).toHaveProperty('size', 1);
    expect(new Set(results.map((result) => result.review.id))).toHaveProperty('size', 1);
    expect(await moderationCounts(patternId)).toEqual({ reports: 1, reviews: 1 });
  });

  it('rate-limits closed-case reopening and then requires materially new evidence', async () => {
    const patternId = await createCommunityPattern();
    const initial = await service.create(accountPrincipal(), patternId, {
      explanation: 'The preview appears to duplicate another catalog item.',
      reason: 'duplicate_or_spam',
    });
    await closeReview(initial.review.id);

    await expect(
      service.create(accountPrincipal(), patternId, {
        explanation: 'A different sentence during the cooldown.',
        reason: 'duplicate_or_spam',
      }),
    ).rejects.toThrow('once every 24 hours');

    const now = Date.now();
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(now + COMMUNITY_REPORT_REOPEN_COOLDOWN_MS + 1);

    await expect(
      service.create(accountPrincipal(), patternId, {
        explanation: '  THE PREVIEW appears to duplicate another catalog item!!!  ',
        reason: 'duplicate_or_spam',
      }),
    ).rejects.toThrow('materially new evidence');

    const reopened = await service.create(accountPrincipal(), patternId, {
      explanation: 'A new source link identifies the original publication.',
      reason: 'copyright_or_publication_rights',
    });
    expect(reopened).toMatchObject({ created: true, review: { status: 'open' } });
    expect(reopened.review.id).not.toBe(initial.review.id);
    expect(await moderationCounts(patternId)).toEqual({ reports: 2, reviews: 2 });
  });

  it('allows a rate-limited report after a newly approved metadata revision', async () => {
    const patternId = await createCommunityPattern();
    const initial = await service.create(accountPrincipal(), patternId, {
      reason: 'inappropriate_or_unsafe_content',
    });
    await closeReview(initial.review.id);
    await createAcceptedMetadataRevision(patternId);

    const now = Date.now();
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(now + COMMUNITY_REPORT_REOPEN_COOLDOWN_MS + 1);
    const reopened = await service.create(accountPrincipal(), patternId, {
      reason: 'misleading_title_or_tags',
    });

    expect(reopened).toMatchObject({ created: true, review: { status: 'open' } });
    expect(reopened.review.id).not.toBe(initial.review.id);
  });

  it('rejects official and unavailable patterns and keeps reports append-only', async () => {
    const officialPatternId = await createCatalogPattern(null, 'available');
    const withdrawnPatternId = await createCatalogPattern(profileId, 'withdrawn');
    const communityPatternId = await createCommunityPattern();

    await expect(
      service.create(accountPrincipal(), officialPatternId, {
        reason: 'duplicate_or_spam',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.create(accountPrincipal(), withdrawnPatternId, {
        reason: 'duplicate_or_spam',
      }),
    ).rejects.toMatchObject({ status: 404 });

    const created = await service.create(accountPrincipal(), communityPatternId, {
      reason: 'duplicate_or_spam',
    });
    await expect(
      dataSource.query(
        `UPDATE moderation.community_reports SET reason = 'other' WHERE id = $1`,
        [created.report.id],
      ),
    ).rejects.toThrow('Catalog review history is append-only');
  });

  function accountPrincipal(id = accountId) {
    return { id, tokenVersion: 1, type: PrincipalType.Account };
  }

  async function createCommunityPattern(): Promise<string> {
    return createCatalogPattern(profileId, 'available');
  }

  async function createCatalogPattern(
    creatorProfileId: string | null,
    status: 'available' | 'withdrawn',
  ): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO catalog.patterns
        (id, title, description, creator_name, creator_profile_id, category_code, width, height,
         palette_size, artifact_object_key, artifact_checksum, artifact_byte_length,
         artifact_schema_version, preview_object_key, visibility, owner_account_id, status)
       VALUES ($1, 'Reportable Pattern', 'A report fixture.', 'Report Fixture', $2, 'other', 2, 2,
         2, $3, $4, 100, 1, $5, 'catalog', NULL, $6)`,
      [
        id,
        creatorProfileId,
        `community/${id}/artifact.bin`,
        'a'.repeat(64),
        `community/${id}/preview.png`,
        status,
      ],
    );
    return id;
  }

  async function closeReview(reviewId: string): Promise<void> {
    const operatorId = randomUUID();
    await dataSource.query(
      `INSERT INTO admin.operator_accounts (id, email, password_hash, totp_secret_encrypted)
       VALUES ($1, $2, 'hash', 'ciphertext')`,
      [operatorId, `test-closure-operator-${operatorId}@example.test`],
    );
    await dataSource.query(
      `UPDATE moderation.post_publication_reviews
       SET status = 'closed', closed_at = now(), updated_at = now(),
           close_outcome = 'no_violation', close_reason = 'test fixture closure',
           close_operator_account_id = $2
       WHERE id = $1`,
      [reviewId, operatorId],
    );
  }

  async function createAcceptedMetadataRevision(patternId: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO catalog.catalog_metadata_revisions
        (account_id, creator_profile_id, community_pattern_id, title, description,
         source_language, category_code, tag_codes, metadata_valid, status)
       VALUES ($1, $2, $3, 'Approved New Title', 'Approved new description.',
         'en', 'other', '{}', true, 'accepted')`,
      [accountId, profileId, patternId],
    );
  }

  async function moderationCounts(patternId: string) {
    const [row] = await dataSource.query<{ reports: number; reviews: number }[]>(
      `SELECT
         COUNT(DISTINCT review.id)::int AS reviews,
         COUNT(report.id)::int AS reports
       FROM moderation.post_publication_reviews review
       LEFT JOIN moderation.community_reports report ON report.review_id = review.id
       WHERE review.community_pattern_id = $1`,
      [patternId],
    );
    return row;
  }
});
