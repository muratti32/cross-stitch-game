import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { PrincipalType } from '../src/auth/entities';
import { CatalogPrecheckService } from '../src/catalog/catalog-precheck.service';
import { CatalogSubmissionService } from '../src/catalog/catalog-submission.service';
import { encodePatternArtifactV1 } from '../src/catalog/pattern-artifact-encoder';
import type { ObjectStorage } from '../src/catalog/storage/object-storage.interface';
import { AppConfigService } from '../src/config/app-config.service';
import { renderPatternPreviewPng } from '../src/conversion/pattern-preview-renderer';
import { createTypeOrmOptions } from '../src/database/typeorm-options';
import { JobStateTransitionService } from '../src/jobs/job-state-transition.service';
import { ProcessingJobsRepository } from '../src/jobs/processing-jobs.repository';

describe('Catalog Submission persistence', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let submissionId: string;
  let accountId: string;
  let operatorId: string;
  let profileId: string;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource(createTypeOrmOptions(postgres.getConnectionUri()));
    await dataSource.initialize();
    await dataSource.runMigrations();

    accountId = randomUUID();
    operatorId = randomUUID();
    profileId = randomUUID();
    const sourcePatternId = randomUUID();
    const processingJobId = randomUUID();
    submissionId = randomUUID();

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
      `INSERT INTO jobs.processing_jobs (id, type, status, payload)
       VALUES ($1, 'catalog_precheck', 'completed', '{}')`,
      [processingJobId],
    );
    await dataSource.query(
      `INSERT INTO catalog.patterns
        (id, title, creator_name, category_code, width, height, palette_size,
         artifact_object_key, artifact_checksum, artifact_byte_length,
         artifact_schema_version, preview_object_key, visibility, owner_account_id)
       VALUES ($1, 'Personal Pattern', 'You', 'other', 2, 2, 2,
         'personal/artifact.bin', $2, 100, 1, 'personal/preview.png', 'personal', $3)`,
      [sourcePatternId, 'a'.repeat(64), accountId],
    );
    await dataSource.query(
      `INSERT INTO catalog.catalog_submissions
        (id, account_id, creator_profile_id, source_pattern_id, processing_job_id,
         title, description, source_language, category_code, tag_codes,
         rights_declared, license_version, rights_declared_at,
         artifact_object_key, artifact_checksum, artifact_byte_length,
         artifact_schema_version, width, height, palette_size,
         preview_object_key, preview_checksum, metadata_valid, technical_valid, status)
       VALUES ($1, $2, $3, $4, $5,
         'Immutable Flower', 'A compact floral design.', 'en', 'other', '{}',
         true, 'v1', now(), 'submissions/artifact.bin', $6, 100,
         1, 2, 2, 2, 'submissions/preview.png', $7, true, true, 'rejected')`,
      [submissionId, accountId, profileId, sourcePatternId, processingJobId, 'b'.repeat(64), 'c'.repeat(64)],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized === true) await dataSource.destroy();
    if (postgres !== undefined) await postgres.stop();
  });

  it('rejects any mutation to the captured submission snapshot', async () => {
    await expect(
      dataSource.query(
        `UPDATE catalog.catalog_submissions SET title = 'Changed' WHERE id = $1`,
        [submissionId],
      ),
    ).rejects.toThrow('Catalog Submission snapshot is immutable');
  });

  it('allows exactly one append-only appeal for a submission', async () => {
    await dataSource.query(
      `INSERT INTO catalog.catalog_appeals (submission_id, account_id, note)
       VALUES ($1, $2, 'Please reconsider')`,
      [submissionId, accountId],
    );
    await expect(
      dataSource.query(
        `INSERT INTO catalog.catalog_appeals (submission_id, account_id)
         VALUES ($1, $2)`,
        [submissionId, accountId],
      ),
    ).rejects.toMatchObject({ constraint: 'UQ_catalog_appeals_submission' });
    await expect(
      dataSource.query(
        `UPDATE catalog.catalog_appeals SET note = 'Changed' WHERE submission_id = $1`,
        [submissionId],
      ),
    ).rejects.toThrow('Catalog review history is append-only');
  });

  it('keeps moderator decisions append-only and unique per review round', async () => {
    await dataSource.query(
      `INSERT INTO catalog.catalog_review_decisions
        (submission_id, review_round, decision, operator_account_id, rejection_reason)
       VALUES ($1, 'initial', 'rejected', $2, 'quality_standard')`,
      [submissionId, operatorId],
    );
    await expect(
      dataSource.query(
        `UPDATE catalog.catalog_review_decisions SET note = 'Changed'
         WHERE submission_id = $1 AND review_round = 'initial'`,
        [submissionId],
      ),
    ).rejects.toThrow('Catalog review history is append-only');
    await expect(
      dataSource.query(
        `INSERT INTO catalog.catalog_review_decisions
          (submission_id, review_round, decision, operator_account_id, rejection_reason)
         VALUES ($1, 'initial', 'rejected', $2, 'safety')`,
        [submissionId, operatorId],
      ),
    ).rejects.toMatchObject({ constraint: 'UQ_catalog_review_decisions_round' });
  });

  it('prevents replacing published Community Pattern bytes or creator attribution', async () => {
    const communityPatternId = randomUUID();
    await dataSource.query(
      `INSERT INTO catalog.patterns
        (id, title, creator_name, creator_profile_id, category_code, width, height,
         palette_size, artifact_object_key, artifact_checksum, artifact_byte_length,
         artifact_schema_version, preview_object_key, visibility, owner_account_id)
       VALUES ($1, 'Community Pattern', 'Stitch Reviewer', $2, 'other', 2, 2,
         2, 'community/artifact.bin', $3, 100, 1, 'community/preview.png', 'catalog', NULL)`,
      [communityPatternId, profileId, 'd'.repeat(64)],
    );
    await expect(
      dataSource.query(
        `UPDATE catalog.patterns SET artifact_object_key = 'community/replaced.bin' WHERE id = $1`,
        [communityPatternId],
      ),
    ).rejects.toThrow('Community Pattern bytes and creator reference are immutable');
  });

  it('runs the immutable snapshot through precheck and a human acceptance transaction', async () => {
    const sourcePatternId = randomUUID();
    const palette = [{ dmcCode: '310', name: 'Black', rgbHex: '#000000' }];
    const grid = Uint8Array.from([1, 0, 0, 1]);
    const artifact = encodePatternArtifactV1({ grid, height: 2, palette, width: 2 });
    const preview = renderPatternPreviewPng({ grid, height: 2, palette, width: 2 });
    const objects = new Map<string, Buffer>([
      ['personal/source-artifact.bin', artifact.bytes],
      ['personal/source-preview.png', preview],
    ]);
    const storage: ObjectStorage = {
      delete: (key) => {
        objects.delete(key);
        return Promise.resolve();
      },
      exists: (key) => Promise.resolve(objects.has(key)),
      get: (key) => Promise.resolve(objects.get(key) ?? null),
      publicUrl: (key) => key,
      put: (key, bytes) => {
        objects.set(key, Buffer.from(bytes));
        return Promise.resolve();
      },
    };
    await dataSource.query(
      `INSERT INTO catalog.patterns
        (id, title, creator_name, category_code, width, height, palette_size,
         artifact_object_key, artifact_checksum, artifact_byte_length,
         artifact_schema_version, preview_object_key, visibility, owner_account_id)
       VALUES ($1, 'Editable Source', 'You', 'other', 2, 2, 1,
         'personal/source-artifact.bin', $2, $3, 1,
         'personal/source-preview.png', 'personal', $4)`,
      [sourcePatternId, artifact.checksum, artifact.byteLength, accountId],
    );

    const jobs = new ProcessingJobsRepository(dataSource, new JobStateTransitionService());
    const precheck = new CatalogPrecheckService(
      { openAiModerationEnabled: false } as AppConfigService,
      dataSource,
      storage,
    );
    const service = new CatalogSubmissionService(dataSource, jobs, precheck, storage);
    const principal = { id: accountId, tokenVersion: 1, type: PrincipalType.Account };
    const input = {
      categoryCode: 'other',
      description: 'An original black and white geometric motif.',
      licenseVersion: 'v1' as const,
      rightsDeclared: true as const,
      sourceLanguage: 'en',
      tagCodes: [],
      title: 'Geometric Motif',
    };

    const created = await service.create(principal, sourcePatternId, input);
    expect(created).toMatchObject({ status: 'precheck_pending', title: input.title });
    await expect(precheck.run(created.id)).resolves.toMatchObject({ status: 'review_pending' });
    const accepted = await service.accept(operatorId, created.id, 'Artifact and rights reviewed.', 'request-25');
    expect(accepted).toMatchObject({ status: 'accepted' });
    expect(accepted.communityPatternId).not.toBeNull();
    await expect(service.accept(operatorId, created.id)).resolves.toMatchObject({
      communityPatternId: accepted.communityPatternId,
      status: 'accepted',
    });

    const [decisionCount, auditCount, publishedCount] = await Promise.all([
      dataSource.query<Array<{ count: string }>>(
        `SELECT count(*) FROM catalog.catalog_review_decisions WHERE submission_id = $1`,
        [created.id],
      ),
      dataSource.query<Array<{ count: string }>>(
        `SELECT count(*) FROM admin.operator_audit_log
         WHERE target_type = 'catalog_submission' AND target_id = $1`,
        [created.id],
      ),
      dataSource.query<Array<{ count: string }>>(
        `SELECT count(*) FROM catalog.patterns WHERE id = $1 AND visibility = 'catalog'`,
        [accepted.communityPatternId],
      ),
    ]);
    expect(decisionCount).toEqual([{ count: '1' }]);
    expect(auditCount).toEqual([{ count: '1' }]);
    expect(publishedCount).toEqual([{ count: '1' }]);

    const resubmitted = await service.create(principal, sourcePatternId, {
      ...input,
      title: 'Geometric Motif, Revised',
    });
    expect(resubmitted.id).not.toBe(created.id);
    await precheck.run(resubmitted.id);
    await expect(
      service.reject(
        operatorId,
        resubmitted.id,
        'quality_standard',
        'The motif needs a cleaner edge treatment.',
      ),
    ).resolves.toMatchObject({ status: 'rejected' });
    await expect(
      service.createAppeal(principal, resubmitted.id, { note: 'Please review the intentional edge.' }),
    ).resolves.toMatchObject({ submissionId: resubmitted.id });
    await expect(
      service.createAppeal(principal, resubmitted.id, { note: 'A second appeal.' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.reject(operatorId, resubmitted.id, 'quality_standard', 'The original decision stands.'),
    ).resolves.toMatchObject({ status: 'appeal_upheld' });
    await expect(service.getMine(principal, resubmitted.id)).resolves.toMatchObject({
      appealed: true,
      rejectionNote: 'The original decision stands.',
      rejectionReason: 'quality_standard',
      status: 'appeal_upheld',
    });
  });
});
