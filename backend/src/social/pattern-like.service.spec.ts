import { PatternLikeService } from './pattern-like.service';
import { PatternLikeEntity } from './entities/pattern-like.entity';
import { PatternEntity } from '../catalog/entities/pattern.entity';
import { CatalogService } from '../catalog/catalog.service';
import { Repository, DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

describe('PatternLikeService', () => {
  let service: PatternLikeService;
  let patternLikeRepository: Repository<PatternLikeEntity>;
  let patternRepository: Repository<PatternEntity>;
  let catalogService: CatalogService;
  let managerFindOne: jest.Mock;
  let managerQuery: jest.Mock;

  beforeEach(() => {
    patternLikeRepository = {
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<PatternLikeEntity>;
    patternRepository = {} as unknown as Repository<PatternEntity>;

    catalogService = {
      formatPattern: jest.fn((p: PatternEntity, _locale: string, liked?: boolean) => ({
        id: p.id,
        title: p.title,
        viewerLiked: liked,
      })),
    } as unknown as CatalogService;

    managerFindOne = jest.fn();
    managerQuery = jest.fn();

    const mockDataSource = {
      transaction: jest.fn(
        async (
          isoOrWork: (m: unknown) => Promise<unknown>,
          maybeWork?: (m: unknown) => Promise<unknown>,
        ) => {
          const work = typeof isoOrWork === 'function' ? isoOrWork : maybeWork;
          if (!work) {
            return null;
          }
          return work({
            findOne: managerFindOne,
            query: managerQuery,
          });
        },
      ),
    } as unknown as DataSource;

    service = new PatternLikeService(
      patternLikeRepository,
      patternRepository,
      mockDataSource,
      catalogService,
    );
  });

  describe('like', () => {
    it('throws NotFoundException if pattern does not exist', async () => {
      managerFindOne.mockResolvedValue(null);

      await expect(service.like('account-uuid', 'pattern-uuid'))
        .rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if pattern is personal', async () => {
      managerFindOne.mockResolvedValue({
        id: 'pattern-uuid',
        visibility: 'personal',
        status: 'available',
      });

      await expect(service.like('account-uuid', 'pattern-uuid'))
        .rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if pattern is not available', async () => {
      managerFindOne.mockResolvedValue({
        id: 'pattern-uuid',
        visibility: 'catalog',
        status: 'removed',
      });

      await expect(service.like('account-uuid', 'pattern-uuid'))
        .rejects.toThrow(NotFoundException);
    });

    it('inserts a like record and increments count on first like', async () => {
      const pattern = {
        id: 'pattern-uuid',
        visibility: 'catalog',
        status: 'available',
        likeCount: 5,
      };
      managerFindOne.mockResolvedValue(pattern);
      // first query: INSERT ... RETURNING id
      managerQuery.mockResolvedValueOnce([{ id: 'like-uuid' }]);
      // second query: UPDATE ... RETURNING like_count
      managerQuery.mockResolvedValueOnce([{ like_count: 6 }]);

      const result = await service.like('account-uuid', 'pattern-uuid');

      expect(result).toEqual({ liked: true, likeCount: 6 });
      expect(managerQuery).toHaveBeenCalledTimes(2);
    });

    it('is idempotent: returns existing count without incrementing if already liked', async () => {
      const pattern = {
        id: 'pattern-uuid',
        visibility: 'catalog',
        status: 'available',
        likeCount: 6,
      };
      managerFindOne.mockResolvedValue(pattern);
      // first query: INSERT ... RETURNING id (conflict yields empty array)
      managerQuery.mockResolvedValueOnce([]);

      const result = await service.like('account-uuid', 'pattern-uuid');

      expect(result).toEqual({ liked: true, likeCount: 6 });
      expect(managerQuery).toHaveBeenCalledTimes(1); // No update query called
    });
  });

  describe('unlike', () => {
    it('throws NotFoundException if pattern does not exist', async () => {
      managerFindOne.mockResolvedValue(null);

      await expect(service.unlike('account-uuid', 'pattern-uuid'))
        .rejects.toThrow(NotFoundException);
    });

    it('deletes like record and decrements count if previously liked', async () => {
      const pattern = {
        id: 'pattern-uuid',
        visibility: 'catalog',
        status: 'available',
        likeCount: 6,
      };
      managerFindOne.mockResolvedValue(pattern);
      // delete query: DELETE ... RETURNING id
      managerQuery.mockResolvedValueOnce([{ id: 'like-uuid' }]);
      // update query: UPDATE ... RETURNING like_count
      managerQuery.mockResolvedValueOnce([{ like_count: 5 }]);

      const result = await service.unlike('account-uuid', 'pattern-uuid');

      expect(result).toEqual({ liked: false, likeCount: 5 });
      expect(managerQuery).toHaveBeenCalledTimes(2);
    });

    it('is idempotent: returns current count without decrementing if not previously liked', async () => {
      const pattern = {
        id: 'pattern-uuid',
        visibility: 'catalog',
        status: 'available',
        likeCount: 5,
      };
      managerFindOne.mockResolvedValue(pattern);
      // delete query returns empty
      managerQuery.mockResolvedValueOnce([]);

      const result = await service.unlike('account-uuid', 'pattern-uuid');

      expect(result).toEqual({ liked: false, likeCount: 5 });
      expect(managerQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('getLikedPatterns', () => {
    it('returns cursor-paginated results formatted using CatalogService', async () => {
      const mockQueryBuilder = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'like-1',
            createdAt: new Date('2026-07-01T00:00:00Z'),
            pattern: { id: 'pattern-1', title: 'Pattern 1' } as PatternEntity,
          },
        ]),
      };

      jest
        .spyOn(patternLikeRepository, 'createQueryBuilder')
        .mockReturnValue(
          mockQueryBuilder as unknown as ReturnType<
            typeof patternLikeRepository.createQueryBuilder
          >,
        );

      const result = await service.getLikedPatterns('account-uuid', { limit: 10, locale: 'en' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({ id: 'pattern-1', title: 'Pattern 1', viewerLiked: true });
      expect(result.nextCursor).toBeNull();
      expect(catalogService.formatPattern).toHaveBeenCalledWith(
        { id: 'pattern-1', title: 'Pattern 1' },
        'en',
        true,
      );
    });
  });
});
