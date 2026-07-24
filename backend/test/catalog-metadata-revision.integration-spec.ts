import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { PrincipalType } from '../src/auth/entities';
import { CatalogMetadataRevisionService } from '../src/catalog/catalog-metadata-revision.service';
import { CatalogPrecheckService } from '../src/catalog/catalog-precheck.service';
import { AppConfigService } from '../src/config/app-config.service';
import { createTypeOrmOptions } from '../src/database/typeorm-options';

describe('Catalog Metadata Revision persistence', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let accountId: string;
  let operatorId: string;
  let profileId: string;
  let patternId: string;
  let revisionId: string;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource(createTypeOrmOptions(postgres.getConnectionUri()));
    await dataSource.initialize();
    await dataSource.runMigrations();

    accountId = randomUUID();
    operatorId = randomUUID();
    profileId = randomUUID();
    patternId = randomUUID();
    revisionId = randomUUID();

    await dataSource.query('INSERT INTO auth.registered_accounts (id) VALUES ($1)', [accountId]);
    await dataSource.query(
      `INSERT INTO admin.operator_accounts
        (id, email, password_hash, totp_secret_encrypted)
       VALUES ($1, 'reviewer@example.test', 'hash', 'ciphertext')`,
      [operatorId],
    );
    await dataSource.query(
      `INSERT INTO moderation.creator_profiles
        (id, account_id, username, display_name)
       VALUES ($1, $2, 'stitch_reviewer', 'Stitch Reviewer')`,
      [profileId, accountId],
    );
    await dataSource.query(
      `INSERT INTO catalog.patterns
        (id, title, description, creator_name, creator_profile_id, category_code, width, height,
         palette_size, artifact_object_key, artifact_checksum, artifact_byte_length,
         artifact_schema_version, preview_object_key, visibility, owner_account_id, status)
       VALUES ($1, 'Original Title', 'Original description.', 'Stitch Reviewer', $2, 'other', 2, 2,
         2, 'community/artifact.bin', $3, 100, 1, 'community/preview.png', 'catalog', NULL, 'available')`,
      [patternId, profileId, 'a'.repeat(64)],
    );
    await dataSource.query(
      `INSERT INTO catalog.catalog_metadata_revisions
        (id, account_id, creator_profile_id, community_pattern_id,
         title, description, source_language, category_code, tag_codes, status)
       VALUES ($1, $2, $3, $4, 'Revised Title', 'Revised description.', 'en', 'other', '{}', 'pending')`,
      [revisionId, accountId, profileId, patternId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized === true) await dataSource.destroy();
    if (postgres !== undefined) await postgres.stop();
  });

  it('rejects any mutation to the captured revision snapshot', async () => {
    await expect(
      dataSource.query(
        `UPDATE catalog.catalog_metadata_revisions SET title = 'Changed' WHERE id = $1`,
        [revisionId],
      ),
    ).rejects.toThrow('Catalog Metadata Revision snapshot is immutable');
  });

  it('allows the status of a captured revision to change', async () => {
    await expect(
      dataSource.query(
        `UPDATE catalog.catalog_metadata_revisions SET status = 'withdrawn' WHERE id = $1`,
        [revisionId],
      ),
    ).resolves.toBeDefined();
    await dataSource.query(
      `UPDATE catalog.catalog_metadata_revisions SET status = 'pending' WHERE id = $1`,
      [revisionId],
    );
  });

  it('enforces at most one active revision slot per Pattern', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO catalog.catalog_metadata_revisions
          (account_id, creator_profile_id, community_pattern_id, title, description, source_language, category_code, tag_codes, status)
         VALUES ($1, $2, $3, 'Another Title', 'Another description.', 'en', 'other', '{}', 'pending')`,
        [accountId, profileId, patternId],
      ),
    ).rejects.toMatchObject({ constraint: 'UQ_catalog_metadata_revisions_active_slot' });

    await dataSource.query(
      `UPDATE catalog.catalog_metadata_revisions SET status = 'withdrawn' WHERE id = $1`,
      [revisionId],
    );
    await expect(
      dataSource.query(
        `INSERT INTO catalog.catalog_metadata_revisions
          (account_id, creator_profile_id, community_pattern_id, title, description, source_language, category_code, tag_codes, status)
         VALUES ($1, $2, $3, 'Another Title', 'Another description.', 'en', 'other', '{}', 'pending')`,
        [accountId, profileId, patternId],
      ),
    ).resolves.toBeDefined();
    await dataSource.query(`DELETE FROM catalog.catalog_metadata_revisions WHERE community_pattern_id = $1 AND title = 'Another Title'`, [patternId]);
    await dataSource.query(
      `UPDATE catalog.catalog_metadata_revisions SET status = 'pending' WHERE id = $1`,
      [revisionId],
    );
  });

  it('keeps metadata appeals and review decisions append-only and unique', async () => {
    await dataSource.query(
      `INSERT INTO catalog.catalog_metadata_appeals (revision_id, account_id, note)
       VALUES ($1, $2, 'Please reconsider')`,
      [revisionId, accountId],
    );
    await expect(
      dataSource.query(
        `INSERT INTO catalog.catalog_metadata_appeals (revision_id, account_id)
         VALUES ($1, $2)`,
        [revisionId, accountId],
      ),
    ).rejects.toMatchObject({ constraint: 'UQ_catalog_metadata_appeals_revision' });
    await expect(
      dataSource.query(
        `UPDATE catalog.catalog_metadata_appeals SET note = 'Changed' WHERE revision_id = $1`,
        [revisionId],
      ),
    ).rejects.toThrow('Catalog review history is append-only');

    await dataSource.query(
      `INSERT INTO catalog.catalog_metadata_review_decisions
        (revision_id, review_round, decision, operator_account_id, rejection_reason)
       VALUES ($1, 'initial', 'rejected', $2, 'quality_standard')`,
      [revisionId, operatorId],
    );
    await expect(
      dataSource.query(
        `UPDATE catalog.catalog_metadata_review_decisions SET note = 'Changed'
         WHERE revision_id = $1 AND review_round = 'initial'`,
        [revisionId],
      ),
    ).rejects.toThrow('Catalog review history is append-only');
    await expect(
      dataSource.query(
        `INSERT INTO catalog.catalog_metadata_review_decisions
          (revision_id, review_round, decision, operator_account_id, rejection_reason)
         VALUES ($1, 'initial', 'rejected', $2, 'safety')`,
        [revisionId, operatorId],
      ),
    ).rejects.toMatchObject({ constraint: 'UQ_catalog_metadata_review_decisions_round' });
  });

  it('lets an owner submit, get blocked by the active slot, withdraw, then resubmit through the service', async () => {
    const otherPatternId = randomUUID();
    await dataSource.query(
      `INSERT INTO catalog.patterns
        (id, title, description, creator_name, creator_profile_id, category_code, width, height,
         palette_size, artifact_object_key, artifact_checksum, artifact_byte_length,
         artifact_schema_version, preview_object_key, visibility, owner_account_id, status)
       VALUES ($1, 'Service Pattern', 'Service description.', 'Stitch Reviewer', $2, 'other', 2, 2,
         2, 'community/artifact2.bin', $3, 100, 1, 'community/preview2.png', 'catalog', NULL, 'available')`,
      [otherPatternId, profileId, 'b'.repeat(64)],
    );

    const precheck = new CatalogPrecheckService(
      { openAiModerationEnabled: false } as AppConfigService,
      dataSource,
      {
        delete: () => Promise.resolve(),
        exists: () => Promise.resolve(false),
        get: () => Promise.resolve(null),
        publicUrl: (key: string) => key,
        put: () => Promise.resolve(),
      },
    );
    const service = new CatalogMetadataRevisionService(dataSource, precheck);
    const principal = { id: accountId, tokenVersion: 1, type: PrincipalType.Account };
    const input = {
      categoryCode: 'other',
      description: 'A refreshed description of the design.',
      sourceLanguage: 'en',
      tagCodes: [],
      title: 'Refreshed Title',
    };

    const created = await service.create(principal, otherPatternId, input);
    expect(created).toMatchObject({ status: 'pending', title: input.title });

    await expect(service.create(principal, otherPatternId, { ...input, title: 'Second Attempt' })).rejects.toMatchObject({
      status: 409,
    });

    const withdrawn = await service.withdraw(principal, created.id);
    expect(withdrawn.status).toBe('withdrawn');

    const resubmitted = await service.create(principal, otherPatternId, { ...input, title: 'Second Attempt' });
    expect(resubmitted.status).toBe('pending');
    expect(resubmitted.id).not.toBe(created.id);

    const mine = await service.myPatterns(principal);
    const entry = mine.find((item) => item.id === otherPatternId);
    expect(entry).toMatchObject({ canSubmitRevision: false });
    expect(entry?.latestRevision?.id).toBe(resubmitted.id);
  });
});
