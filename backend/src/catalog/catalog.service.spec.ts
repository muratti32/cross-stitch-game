import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PatternEntity, StaffPickEntity, TagEntity, TagLabelEntity, CategoryEntity } from './entities';
import { PatternLikeService } from '../social/pattern-like.service';
import { CreatorBlockService } from '../social/creator-block.service';
import { PrincipalType } from '../auth/entities';
import { AuthPrincipal } from '../auth/auth.types';
import { Repository, DataSource } from 'typeorm';
import { ObjectStorage } from './storage/object-storage.interface';

describe('CatalogService - Creator Block Filtering', () => {
  let service: CatalogService;
  let patternRepository: Repository<PatternEntity>;
  let staffPickRepository: Repository<StaffPickEntity>;
  let creatorBlockService: CreatorBlockService;
  let patternLikeService: PatternLikeService;
  let mockPatternQueryBuilder: ReturnType<typeof patternRepository.createQueryBuilder>;
  let mockStaffPickQueryBuilder: ReturnType<typeof staffPickRepository.createQueryBuilder>;

  beforeEach(() => {
    patternRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn().mockResolvedValue({
        id: 'pattern-1',
        title: 'Pattern 1',
        creatorName: 'Creator 1',
        categoryCode: 'cat-1',
        width: 10,
        height: 10,
        paletteSize: 5,
        previewObjectKey: 'preview-1',
        unlockPriceTier: null,
        publishedAt: new Date('2026-07-20T00:00:00Z'),
        likeCount: 0,
        status: 'available',
        visibility: 'catalog',
        creatorProfile: {
          id: 'creator-profile-1',
          username: 'creator1',
          displayName: 'Creator One',
        },
        tags: [],
      }),
    } as unknown as Repository<PatternEntity>;

    staffPickRepository = {
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<StaffPickEntity>;

    const patternQueryBuilderMock = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'pattern-1',
          title: 'Pattern 1',
          creatorName: 'Creator 1',
          categoryCode: 'cat-1',
          width: 10,
          height: 10,
          paletteSize: 5,
          previewObjectKey: 'preview-1',
          unlockPriceTier: null,
          publishedAt: new Date('2026-07-20T00:00:00Z'),
          likeCount: 0,
          creatorProfile: {
            id: 'creator-profile-1',
            username: 'creator1',
            displayName: 'Creator One',
          },
          tags: [],
        },
      ]),
    };
    mockPatternQueryBuilder = patternQueryBuilderMock as unknown as ReturnType<
      typeof patternRepository.createQueryBuilder
    >;

    const staffPickQueryBuilderMock = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'pick-1',
          position: 1,
          pattern: {
            id: 'pattern-1',
            title: 'Pattern 1',
            creatorName: 'Creator 1',
            categoryCode: 'cat-1',
            width: 10,
            height: 10,
            paletteSize: 5,
            previewObjectKey: 'preview-1',
            unlockPriceTier: null,
            publishedAt: new Date('2026-07-20T00:00:00Z'),
            likeCount: 0,
            creatorProfile: {
              id: 'creator-profile-1',
              username: 'creator1',
              displayName: 'Creator One',
            },
            tags: [],
          },
        },
      ]),
    };
    mockStaffPickQueryBuilder = staffPickQueryBuilderMock as unknown as ReturnType<
      typeof staffPickRepository.createQueryBuilder
    >;

    jest.spyOn(patternRepository, 'createQueryBuilder').mockReturnValue(mockPatternQueryBuilder);
    jest.spyOn(staffPickRepository, 'createQueryBuilder').mockReturnValue(mockStaffPickQueryBuilder);

    creatorBlockService = {
      hasBlocks: jest.fn(),
    } as unknown as CreatorBlockService;

    patternLikeService = {
      getViewerLikedPatternIds: jest.fn().mockResolvedValue(new Set()),
    } as unknown as PatternLikeService;

    const mockStorage = {
      publicUrl: jest.fn().mockReturnValue('http://fake/preview.png'),
    };

    service = new CatalogService(
      patternRepository,
      {} as unknown as Repository<TagEntity>,
      {} as unknown as Repository<TagLabelEntity>,
      staffPickRepository,
      {} as unknown as Repository<CategoryEntity>,
      mockStorage as unknown as ObjectStorage,
      {} as unknown as DataSource,
      patternLikeService,
      creatorBlockService,
    );
  });

  describe('filtering by blocks', () => {
    const blockingPrincipal: AuthPrincipal = {
      id: 'blocking-account-uuid',
      tokenVersion: 1,
      type: PrincipalType.Account,
    };

    const guestPrincipal: AuthPrincipal = {
      id: 'guest-uuid',
      tokenVersion: 1,
      type: PrincipalType.Guest,
    };

    it('does not filter if principal is guest or anonymous', async () => {
      // 1. searchPatterns
      await service.searchPatterns('query', 10, 'en', guestPrincipal);
      expect(creatorBlockService.hasBlocks).not.toHaveBeenCalled();
      expect(mockPatternQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS'),
        expect.any(Object),
      );

      // 2. getNewPatterns
      await service.getNewPatterns(10, undefined, 'en', undefined);
      expect(creatorBlockService.hasBlocks).not.toHaveBeenCalled();

      // 3. getPatterns
      await service.getPatterns({ limit: 10 });
      expect(creatorBlockService.hasBlocks).not.toHaveBeenCalled();

      // 4. getStaffPicks
      await service.getStaffPicks('en', undefined);
      expect(creatorBlockService.hasBlocks).not.toHaveBeenCalled();
    });

    it('does not filter if registered account has no blocks', async () => {
      jest.spyOn(creatorBlockService, 'hasBlocks').mockResolvedValue(false);

      await service.searchPatterns('query', 10, 'en', blockingPrincipal);

      expect(creatorBlockService.hasBlocks).toHaveBeenCalledWith('blocking-account-uuid');
      expect(mockPatternQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS'),
        expect.any(Object),
      );
    });

    it('filters out blocked creator patterns in SQL when account has blocks', async () => {
      jest.spyOn(creatorBlockService, 'hasBlocks').mockResolvedValue(true);

      // Test searchPatterns
      await service.searchPatterns('query', 10, 'en', blockingPrincipal);
      expect(mockPatternQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS'),
        { accountId: 'blocking-account-uuid' },
      );

      // Test getNewPatterns
      jest.clearAllMocks();
      await service.getNewPatterns(10, undefined, 'en', blockingPrincipal);
      expect(mockPatternQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS'),
        { accountId: 'blocking-account-uuid' },
      );

      // Test getPatterns
      jest.clearAllMocks();
      await service.getPatterns({ limit: 10, principal: blockingPrincipal });
      expect(mockPatternQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS'),
        { accountId: 'blocking-account-uuid' },
      );

      // Test getStaffPicks
      jest.clearAllMocks();
      await service.getStaffPicks('en', blockingPrincipal);
      expect(mockStaffPickQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS'),
        { accountId: 'blocking-account-uuid' },
      );
    });

    it('does not apply block filtering in getPatternById', async () => {
      jest.spyOn(creatorBlockService, 'hasBlocks').mockResolvedValue(true);

      await service.getPatternById('pattern-1', 'en', blockingPrincipal);

      expect(creatorBlockService.hasBlocks).not.toHaveBeenCalled();
    });
  });

  describe('closure hold filtering', () => {
    it('throws NotFoundException in getPatternById if the creator profile has closureHoldAt set', async () => {
      jest.spyOn(patternRepository, 'findOne').mockResolvedValue({
        id: 'pattern-1',
        title: 'Pattern 1',
        creatorName: 'Creator 1',
        categoryCode: 'cat-1',
        width: 10,
        height: 10,
        paletteSize: 5,
        previewObjectKey: 'preview-1',
        unlockPriceTier: null,
        publishedAt: new Date('2026-07-20T00:00:00Z'),
        likeCount: 0,
        status: 'available',
        visibility: 'catalog',
        creatorProfile: {
          id: 'creator-profile-1',
          username: 'creator1',
          displayName: 'Creator One',
          closureHoldAt: new Date(),
        },
        tags: [],
      } as unknown as PatternEntity);

      await expect(service.getPatternById('pattern-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('adds hold filtering condition in public query-builder paths', async () => {
      jest.clearAllMocks();
      await service.getNewPatterns(10);
      expect(mockPatternQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(creatorProfile.id IS NULL OR creatorProfile.closureHoldAt IS NULL)',
      );

      jest.clearAllMocks();
      await service.getPatterns({ limit: 10 });
      expect(mockPatternQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(creatorProfile.id IS NULL OR creatorProfile.closureHoldAt IS NULL)',
      );

      jest.clearAllMocks();
      await service.searchPatterns('query');
      expect(mockPatternQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(creatorProfile.id IS NULL OR creatorProfile.closureHoldAt IS NULL)',
      );

      jest.clearAllMocks();
      await service.getStaffPicks();
      expect(mockStaffPickQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(creatorProfile.id IS NULL OR creatorProfile.closureHoldAt IS NULL)',
      );
    });
  });

  describe('Pattern Thumbnail URLs', () => {
    it('includes public Thumbnail URLs when a renderer version was stored', () => {
      const pattern = {
        id: '44444444-4444-4444-8444-444444444444',
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        thumbnailRendererVersion: 1,
        previewObjectKey: 'patterns/44444444-4444-4444-8444-444444444444/preview.png',
      } as PatternEntity;
      const storage = {
        publicUrl: (key: string) => `https://cdn.example/${key}`,
      } as ObjectStorage;
      const thumbnailService = new CatalogService(
        patternRepository,
        {} as Repository<TagEntity>,
        {} as Repository<TagLabelEntity>,
        staffPickRepository,
        {} as Repository<CategoryEntity>,
        storage,
        {} as DataSource,
        patternLikeService,
        creatorBlockService,
      );

      expect(thumbnailService.formatPattern(pattern, 'en').thumbnailUrls).toEqual({
        browsing: 'https://cdn.example/patterns/44444444-4444-4444-8444-444444444444/thumbnail-browsing.png',
        detail: 'https://cdn.example/patterns/44444444-4444-4444-8444-444444444444/thumbnail-detail.png',
      });
    });

    it('returns null Thumbnail URLs when no renderer version was stored', () => {
      const pattern = {
        id: '55555555-5555-4555-8555-555555555555',
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        thumbnailRendererVersion: null,
        previewObjectKey: 'patterns/55555555-5555-4555-8555-555555555555/preview.png',
      } as PatternEntity;

      expect(service.formatPattern(pattern, 'en').thumbnailUrls).toBeNull();
    });
  });
});
