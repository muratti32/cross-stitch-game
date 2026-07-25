import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PatternLikeEntity } from './entities/pattern-like.entity';
import { PatternEntity } from '../catalog/entities/pattern.entity';
import { CatalogService } from '../catalog/catalog.service';

interface LikedCursor {
  createdAt: string;
  id: string;
}

function encodeLikedCursor(cursor: LikedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

function decodeLikedCursor(cursorStr: string): LikedCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursorStr, 'base64').toString('utf8'),
    ) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed.createdAt === 'string' &&
      typeof parsed.id === 'string'
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // ignore
  }
  return null;
}

@Injectable()
export class PatternLikeService {
  constructor(
    @InjectRepository(PatternLikeEntity)
    private readonly patternLikeRepository: Repository<PatternLikeEntity>,
    @InjectRepository(PatternEntity)
    private readonly patternRepository: Repository<PatternEntity>,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => CatalogService))
    private readonly catalogService: CatalogService,
  ) {}

  async getViewerLikedPatternIds(accountId: string, patternIds: string[]): Promise<Set<string>> {
    if (!patternIds || patternIds.length === 0) {
      return new Set();
    }
    const likes = await this.patternLikeRepository.createQueryBuilder('like')
      .select('like.patternId', 'patternId')
      .where('like.accountId = :accountId', { accountId })
      .andWhere('like.patternId IN (:...patternIds)', { patternIds })
      .getRawMany<{ patternId: string }>();
    return new Set(likes.map(l => l.patternId));
  }

  async like(accountId: string, patternId: string): Promise<{ liked: boolean; likeCount: number }> {
    return await this.dataSource.transaction(async (manager) => {
      const res = await this.likeWithManager(manager, accountId, patternId);
      return { liked: res.liked, likeCount: res.likeCount };
    });
  }

  async likeWithManager(
    manager: EntityManager,
    accountId: string,
    patternId: string,
  ): Promise<{ liked: boolean; likeCount: number; wasInserted: boolean }> {
    const pattern = await manager.findOne(PatternEntity, {
      where: { id: patternId },
    });
    if (!pattern || pattern.visibility === 'personal' || pattern.status !== 'available') {
      throw new NotFoundException(`Pattern with ID ${patternId} not found`);
    }

    const insertResult = await manager.query<{ id: string }[]>(
      `INSERT INTO "social"."pattern_likes" ("id", "account_id", "pattern_id")
       VALUES (gen_random_uuid(), $1, $2)
       ON CONFLICT ON CONSTRAINT "UQ_pattern_likes_account_pattern" DO NOTHING
       RETURNING "id"`,
      [accountId, patternId],
    );

    const wasInserted = insertResult.length > 0;
    let finalLikeCount = pattern.likeCount;

    if (wasInserted) {
      const updateResult = await manager.query<{ like_count: number }[]>(
        `UPDATE catalog.patterns
         SET like_count = like_count + 1
         WHERE id = $1
         RETURNING like_count`,
        [patternId],
      );
      finalLikeCount = updateResult[0]?.like_count ?? (pattern.likeCount + 1);
    }

    return { liked: true, likeCount: finalLikeCount, wasInserted };
  }

  async unlike(accountId: string, patternId: string): Promise<{ liked: boolean; likeCount: number }> {
    return await this.dataSource.transaction(async (manager) => {
      // A Like stays reversible even after the Pattern leaves the catalog, so
      // unlike only requires a catalog Pattern, not an available one.
      const pattern = await manager.findOne(PatternEntity, {
        where: { id: patternId },
      });
      if (!pattern || pattern.visibility === 'personal') {
        throw new NotFoundException(`Pattern with ID ${patternId} not found`);
      }

      const deleteResult = await manager.query<{ id: string }[]>(
        `DELETE FROM "social"."pattern_likes"
         WHERE account_id = $1 AND pattern_id = $2
         RETURNING id`,
        [accountId, patternId],
      );

      const wasDeleted = deleteResult.length > 0;
      let finalLikeCount = pattern.likeCount;

      if (wasDeleted) {
        const updateResult = await manager.query<{ like_count: number }[]>(
          `UPDATE catalog.patterns
           SET like_count = GREATEST(like_count - 1, 0)
           WHERE id = $1
           RETURNING like_count`,
          [patternId],
        );
        finalLikeCount = updateResult[0]?.like_count ?? Math.max(pattern.likeCount - 1, 0);
      }

      return { liked: false, likeCount: finalLikeCount };
    });
  }

  async getLikedPatterns(
    accountId: string,
    options: { cursor?: string; limit: number; locale: string },
  ) {
    const limit = options.limit || 10;
    const locale = options.locale || 'en';

    const queryBuilder = this.patternLikeRepository.createQueryBuilder('like')
      .innerJoinAndSelect('like.pattern', 'pattern')
      .leftJoinAndSelect('pattern.tags', 'tag')
      .leftJoinAndSelect('tag.labels', 'label')
      .leftJoinAndSelect('pattern.creatorProfile', 'creatorProfile')
      .where('like.accountId = :accountId', { accountId })
      .andWhere('pattern.status = :status', { status: 'available' });

    if (options.cursor) {
      const decoded = decodeLikedCursor(options.cursor);
      if (decoded) {
        queryBuilder.andWhere(
          '(like.createdAt < :createdAt OR (like.createdAt = :createdAt AND like.id < :id))',
          {
            createdAt: new Date(decoded.createdAt),
            id: decoded.id,
          },
        );
      }
    }

    queryBuilder
      .orderBy('like.createdAt', 'DESC')
      .addOrderBy('like.id', 'DESC')
      .take(limit + 1);

    const likes = await queryBuilder.getMany();
    const hasMore = likes.length > limit;
    const items = likes.slice(0, limit);

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeLikedCursor({
        createdAt: lastItem.createdAt.toISOString(),
        id: lastItem.id,
      });
    }

    return {
      items: items.map((like) =>
        this.catalogService.formatPattern(like.pattern, locale, true),
      ),
      nextCursor,
    };
  }
}
