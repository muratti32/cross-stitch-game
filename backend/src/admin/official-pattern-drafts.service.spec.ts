import { DataSource, EntityManager } from 'typeorm';

import { CatalogService } from '../catalog/catalog.service';
import { PatternEntity, TagEntity } from '../catalog/entities';
import { LocalObjectStorage } from '../catalog/storage/local-object-storage';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository';
import { OfficialPatternDraftEntity, OfficialPatternDraftStatus } from './entities';
import { OfficialPatternDraftsService } from './official-pattern-drafts.service';
import { OperatorAuditLogService } from './operator-audit-log.service';

const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const PATTERN_ID = '33333333-3333-4333-8333-333333333333';

function readyDraft(): OfficialPatternDraftEntity {
  return {
    artifactByteLength: 1234,
    artifactChecksum: 'a'.repeat(64),
    artifactObjectKey: `official-pattern-drafts/${DRAFT_ID}/artifact-v1.bin`,
    artifactSchemaVersion: 1,
    createdAt: new Date(),
    createdByOperatorId: OPERATOR_ID,
    failureReason: null,
    height: 32,
    id: DRAFT_ID,
    maxColors: 20,
    paletteSize: 5,
    previewObjectKey: `official-pattern-drafts/${DRAFT_ID}/preview.png`,
    processingJobId: '44444444-4444-4444-8444-444444444444',
    publishedPatternId: null,
    shortEdgeCells: 32,
    sourceByteLength: 999,
    sourceChecksum: 'b'.repeat(64),
    sourceContentType: 'image/png',
    sourceHeight: 32,
    sourceObjectKey: `official-pattern-drafts/${DRAFT_ID}/source.png`,
    sourceWidth: 32,
    status: OfficialPatternDraftStatus.Ready,
    stitchableCellCount: 500,
    updatedAt: new Date(),
    width: 32,
  };
}

function buildService(draft: OfficialPatternDraftEntity): {
  service: OfficialPatternDraftsService;
  upsertPatternWithManager: jest.Mock;
  draftSave: jest.Mock;
  storagePut: jest.Mock;
} {
  const draftSave = jest.fn((value: OfficialPatternDraftEntity) => Promise.resolve(value));
  const draftFindOne = jest.fn().mockResolvedValue({ ...draft });
  const draftRepository = { findOne: draftFindOne, save: draftSave };

  const tagFindOne = jest.fn().mockResolvedValue({ code: 'retro' });
  const tagRepository = { findOne: tagFindOne };

  const patternFindOne = jest.fn().mockResolvedValue(null);
  const patternRepository = { findOne: patternFindOne, findOneBy: patternFindOne };

  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === OfficialPatternDraftEntity) return draftRepository;
      if (entity === TagEntity) return tagRepository;
      if (entity === PatternEntity) return patternRepository;
      throw new Error(`Unexpected repository requested: ${String(entity)}`);
    },
    query: jest.fn().mockResolvedValue([]),
  } as unknown as EntityManager;

  const dataSource = {
    getRepository: () => ({}),
    transaction: async <T>(work: (m: EntityManager) => Promise<T>) => work(manager),
  } as unknown as DataSource;

  const storagePut = jest.fn().mockResolvedValue(undefined);
  const storage = {
    delete: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(Buffer.from('bytes')),
    put: storagePut,
  } as unknown as LocalObjectStorage;

  const upsertPatternWithManager = jest
    .fn()
    .mockResolvedValue({ id: PATTERN_ID });
  const catalogService = {
    upsertPatternWithManager,
  } as unknown as CatalogService;

  const auditLog = { record: jest.fn().mockResolvedValue(undefined) } as unknown as OperatorAuditLogService;

  const service = new OfficialPatternDraftsService(
    dataSource,
    storage,
    {} as ProcessingJobsRepository,
    catalogService,
    auditLog,
    // The service only calls .findOneBy/.findOne through the transaction's
    // manager for this method; the module-level repository isn't exercised.
    { findOneBy: jest.fn() } as never,
  );

  return { draftSave, service, storagePut, upsertPatternWithManager };
}

describe('OfficialPatternDraftsService.publishDraft idempotency', () => {
  const publishInput = {
    categoryCode: 'animals',
    creatorName: 'Stitch Wish Team',
    paid: false,
    tagCodes: ['retro'],
    title: 'Autumn Leaf',
  };

  it('publishes a ready draft exactly once: creates the catalog pattern and marks the draft published', async () => {
    const { service, upsertPatternWithManager } = buildService(readyDraft());

    const result = await service.publishDraft(OPERATOR_ID, DRAFT_ID, publishInput, null);

    expect(result).toEqual({ draftId: DRAFT_ID, patternId: PATTERN_ID, status: 'published' });
    expect(upsertPatternWithManager).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: replaying publish on an already-published draft returns the same result without creating a second pattern', async () => {
    const published = {
      ...readyDraft(),
      publishedPatternId: PATTERN_ID,
      status: OfficialPatternDraftStatus.Published,
    };
    const { service, upsertPatternWithManager, draftSave } = buildService(published);

    const result = await service.publishDraft(OPERATOR_ID, DRAFT_ID, publishInput, null);

    expect(result).toEqual({ draftId: DRAFT_ID, patternId: PATTERN_ID, status: 'published' });
    expect(upsertPatternWithManager).not.toHaveBeenCalled();
    expect(draftSave).not.toHaveBeenCalled();
  });

  it('rejects publishing a draft that is not yet ready', async () => {
    const pending = { ...readyDraft(), status: OfficialPatternDraftStatus.Pending };
    const { service, upsertPatternWithManager } = buildService(pending);

    await expect(
      service.publishDraft(OPERATOR_ID, DRAFT_ID, publishInput, null),
    ).rejects.toThrow(/not ready to publish/);
    expect(upsertPatternWithManager).not.toHaveBeenCalled();
  });
});
