import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PatternThumbnailStagingService } from './pattern-thumbnail-staging.service';

describe('PatternThumbnailStagingService', () => {
  let service: PatternThumbnailStagingService;
  let fakeStorage: {
    put: jest.Mock;
    delete: jest.Mock;
    get: jest.Mock;
    publicUrl: jest.Mock;
    exists: jest.Mock;
    list: jest.Mock;
  };
  let fakeRepo: {
    upsert: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let fakeDataSource: {
    getRepository: jest.Mock;
  };

  beforeEach(() => {
    // Silence the Nest logger in the spec
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    fakeStorage = {
      put: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      publicUrl: jest.fn(),
      exists: jest.fn(),
      list: jest.fn(),
    };

    const mockDeleteQueryBuilder = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    fakeRepo = {
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      createQueryBuilder: jest.fn().mockReturnValue(mockDeleteQueryBuilder),
    };

    fakeDataSource = {
      getRepository: jest.fn().mockReturnValue(fakeRepo),
    };

    service = new PatternThumbnailStagingService(
      fakeDataSource as unknown as DataSource,
      fakeStorage,
    );
  });

  const validPalette = [
    { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
    { dmcCode: 'WHITE', name: 'White', rgbHex: '#FFFFFF' },
  ];
  const validGrid = new Uint8Array([1, 2, 2, 1]); // 2x2 grid

  it('stages both variants under arbitrary keys', async () => {
    const result = await service.stageThumbnails({
      grid: validGrid,
      height: 2,
      idForLogging: 'draft-id',
      keys: {
        thumbnailBrowsing: 'official-pattern-drafts/draft-id/thumbnail-browsing.png',
        thumbnailDetail: 'official-pattern-drafts/draft-id/thumbnail-detail.png',
      },
      ownerLabel: 'Official Pattern Draft',
      palette: validPalette,
      width: 2,
    });

    expect(result).toEqual({
      version: 1,
      keys: [
        'official-pattern-drafts/draft-id/thumbnail-browsing.png',
        'official-pattern-drafts/draft-id/thumbnail-detail.png',
      ],
    });
    expect(fakeStorage.put).toHaveBeenCalledWith(
      'official-pattern-drafts/draft-id/thumbnail-browsing.png',
      expect.any(Buffer),
      'image/png',
    );
    expect(fakeStorage.put).toHaveBeenCalledWith(
      'official-pattern-drafts/draft-id/thumbnail-detail.png',
      expect.any(Buffer),
      'image/png',
    );
  });

  it('returns null without staging when rendering arbitrary keys fails', async () => {
    const result = await service.stageThumbnails({
      grid: new Uint8Array([1, 2]),
      height: 2,
      idForLogging: 'draft-id',
      keys: {
        thumbnailBrowsing: 'official-pattern-drafts/draft-id/thumbnail-browsing.png',
        thumbnailDetail: 'official-pattern-drafts/draft-id/thumbnail-detail.png',
      },
      ownerLabel: 'Official Pattern Draft',
      palette: validPalette,
      width: 2,
    });

    expect(result).toBeNull();
    expect(fakeStorage.put).not.toHaveBeenCalled();
  });

  it('stages exactly two objects and returns the renderer version and keys', async () => {
    const input = {
      patternId: 'test-pattern-id',
      width: 2,
      height: 2,
      palette: validPalette,
      grid: validGrid,
    };

    const result = await service.stagePersonalPatternThumbnails(input);

    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.keys).toEqual([
      'personal-patterns/test-pattern-id/thumbnail-browsing.png',
      'personal-patterns/test-pattern-id/thumbnail-detail.png',
    ]);

    // Check that we staged two objects with correct keys and content types
    expect(fakeStorage.put).toHaveBeenCalledTimes(2);
    expect(fakeStorage.put).toHaveBeenNthCalledWith(
      1,
      'personal-patterns/test-pattern-id/thumbnail-browsing.png',
      expect.any(Buffer),
      'image/png',
    );
    expect(fakeStorage.put).toHaveBeenNthCalledWith(
      2,
      'personal-patterns/test-pattern-id/thumbnail-detail.png',
      expect.any(Buffer),
      'image/png',
    );

    // Verify db interaction
    expect(fakeRepo.upsert).toHaveBeenCalledTimes(2);
    expect(fakeRepo.update).toHaveBeenCalledTimes(2);
  });

  it('returns null without throwing or storing anything when the renderer fails', async () => {
    const input = {
      patternId: 'test-pattern-id',
      width: 2,
      height: 2,
      palette: validPalette,
      grid: new Uint8Array([1, 2]), // grid size mismatch (should be 4)
    };

    const result = await service.stagePersonalPatternThumbnails(input);

    expect(result).toBeNull();
    expect(fakeStorage.put).not.toHaveBeenCalled();
    // Verify cleanup was run
    expect(fakeStorage.delete).toHaveBeenCalledTimes(2);
    expect(fakeRepo.createQueryBuilder).toHaveBeenCalled();
  });

  it('returns null without throwing and cleans up when object storage fails', async () => {
    fakeStorage.put.mockRejectedValueOnce(new Error('Storage upload failed'));

    const input = {
      patternId: 'test-pattern-id',
      width: 2,
      height: 2,
      palette: validPalette,
      grid: validGrid,
    };

    const result = await service.stagePersonalPatternThumbnails(input);

    expect(result).toBeNull();
    // Attempted to put the first one, then failed, should not have put the second
    expect(fakeStorage.put).toHaveBeenCalledTimes(1);

    // Cleanup should be triggered
    expect(fakeStorage.delete).toHaveBeenCalledTimes(2);
    expect(fakeStorage.delete).toHaveBeenCalledWith('personal-patterns/test-pattern-id/thumbnail-browsing.png');
    expect(fakeStorage.delete).toHaveBeenCalledWith('personal-patterns/test-pattern-id/thumbnail-detail.png');

    expect(fakeRepo.createQueryBuilder).toHaveBeenCalled();
  });
});
