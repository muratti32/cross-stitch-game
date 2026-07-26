import { DataSource, EntityManager } from 'typeorm';

import type { ConversionEngineClient, ConversionEngineResponse } from '../conversion/conversion-engine.client';
import type { PatternThumbnailStagingService } from '../conversion/pattern-thumbnail-staging.service';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository';
import { ObjectRegistryEntity } from '../sessions/entities';
import { OfficialPatternDraftEntity, OfficialPatternDraftStatus } from './entities';
import { OfficialPatternDraftJobConsumerService } from './official-pattern-draft-job-consumer.service';

const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '44444444-4444-4444-8444-444444444444';

type PersistableConsumer = {
  persistResult(
    draft: OfficialPatternDraftEntity,
    response: ConversionEngineResponse,
  ): Promise<{ processingJobId: string }>;
};

function processingDraft(): OfficialPatternDraftEntity {
  return {
    artifactByteLength: null,
    artifactChecksum: null,
    artifactObjectKey: null,
    artifactSchemaVersion: null,
    createdAt: new Date(),
    createdByOperatorId: '11111111-1111-4111-8111-111111111111',
    failureReason: null,
    height: null,
    id: DRAFT_ID,
    maxColors: 5,
    paletteSize: null,
    previewObjectKey: null,
    processingJobId: JOB_ID,
    publishedPatternId: null,
    shortEdgeCells: 32,
    sourceByteLength: 100,
    sourceChecksum: 'a'.repeat(64),
    sourceContentType: 'image/png',
    sourceHeight: 32,
    sourceObjectKey: `official-pattern-drafts/${DRAFT_ID}/source.png`,
    sourceWidth: 32,
    status: OfficialPatternDraftStatus.Processing,
    stitchableCellCount: null,
    thumbnailRendererVersion: null,
    updatedAt: new Date(),
    width: null,
  };
}

describe('OfficialPatternDraftJobConsumerService', () => {
  it('marks a draft Ready with no renderer version when Thumbnail rendering fails', async () => {
    const draft = processingDraft();
    const current = { ...draft };
    const draftSave = jest.fn().mockResolvedValue(current);
    const registryUpdate = jest.fn().mockResolvedValue({ affected: 4 });
    const registryUpsert = jest.fn().mockResolvedValue({});
    const draftRepository = {
      findOneBy: jest.fn().mockResolvedValue(current),
      save: draftSave,
    };
    const registryRepository = {
      update: registryUpdate,
      upsert: registryUpsert,
    };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === OfficialPatternDraftEntity) {
          return draftRepository;
        }
        if (entity === ObjectRegistryEntity) {
          return registryRepository;
        }
        throw new Error(`Unexpected repository requested: ${String(entity)}`);
      },
    } as unknown as EntityManager;
    const dataSource = {
      getRepository: () => registryRepository,
      transaction: async <T>(work: (transactionManager: EntityManager) => Promise<T>) =>
        work(manager),
    } as unknown as DataSource;
    const thumbnailStaging = {
      stageThumbnails: jest.fn().mockResolvedValue(null),
    } as unknown as PatternThumbnailStagingService;
    const processingJobs = {
      completeFromRunning: jest.fn().mockResolvedValue(true),
    } as unknown as ProcessingJobsRepository;
    const storage = {
      put: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OfficialPatternDraftJobConsumerService(
      dataSource,
      {} as ConversionEngineClient,
      processingJobs,
      storage as never,
      thumbnailStaging,
    );
    const grid = Buffer.alloc(32 * 32, 1);
    const response: ConversionEngineResponse = {
      dmc_palette_version: '2026.1',
      engine_version: 'v1',
      grid: grid.toString('base64'),
      palette: [{ dmc_code: '310', name: 'Black', rgb_hex: '#000000' }],
      preview_png: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'),
      recipe_version: 'v1',
      statistics: {
        distinct_colors: 1,
        height: 32,
        total_stitchable_cells: 1024,
        width: 32,
      },
    };

    await expect(
      (service as unknown as PersistableConsumer).persistResult(draft, response),
    ).resolves.toEqual({ processingJobId: JOB_ID });

    expect(thumbnailStaging.stageThumbnails).toHaveBeenCalledTimes(1);
    expect(draftSave).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OfficialPatternDraftStatus.Ready,
        thumbnailRendererVersion: null,
      }),
    );
    expect(registryUpdate).toHaveBeenCalledWith(
      [
        { objectKey: `official-pattern-drafts/${DRAFT_ID}/artifact-v1.bin` },
        { objectKey: `official-pattern-drafts/${DRAFT_ID}/preview.png` },
      ],
      { missing: false, state: 'available' },
    );
  });
});
