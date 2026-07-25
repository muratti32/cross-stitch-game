import { CreatorBlockService } from './creator-block.service';
import { CreatorBlockEntity } from './entities/creator-block.entity';
import { CreatorProfileEntity } from '../creator-profile/entities/creator-profile.entity';
import { Repository } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('CreatorBlockService', () => {
  let service: CreatorBlockService;
  let creatorBlockRepository: Repository<CreatorBlockEntity>;
  let creatorProfileRepository: Repository<CreatorProfileEntity>;

  beforeEach(() => {
    creatorBlockRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      upsert: jest.fn(),
    } as unknown as Repository<CreatorBlockEntity>;

    creatorProfileRepository = {
      findOne: jest.fn(),
    } as unknown as Repository<CreatorProfileEntity>;

    service = new CreatorBlockService(creatorBlockRepository, creatorProfileRepository);
  });

  describe('block', () => {
    it('throws NotFoundException if creator profile does not exist', async () => {
      jest.spyOn(creatorProfileRepository, 'findOne').mockResolvedValue(null);

      await expect(service.block('account-uuid', 'creator-uuid'))
        .rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if account attempts to block their own profile', async () => {
      const selfProfile = {
        id: 'creator-uuid',
        accountId: 'account-uuid',
      } as CreatorProfileEntity;
      jest.spyOn(creatorProfileRepository, 'findOne').mockResolvedValue(selfProfile);

      await expect(service.block('account-uuid', 'creator-uuid'))
        .rejects.toThrow(BadRequestException);
    });

    it('writes the block relationship, returning blocked: true', async () => {
      const otherProfile = {
        id: 'creator-uuid',
        accountId: 'other-account-uuid',
      } as CreatorProfileEntity;
      jest.spyOn(creatorProfileRepository, 'findOne').mockResolvedValue(otherProfile);

      const result = await service.block('account-uuid', 'creator-uuid');

      expect(result).toEqual({ blocked: true });
      expect(creatorBlockRepository.upsert).toHaveBeenCalledWith(
        { accountId: 'account-uuid', creatorProfileId: 'creator-uuid' },
        expect.objectContaining({
          conflictPaths: ['accountId', 'creatorProfileId'],
        }),
      );
    });

    it('is idempotent: a repeated block conflicts away and still returns blocked: true', async () => {
      const otherProfile = {
        id: 'creator-uuid',
        accountId: 'other-account-uuid',
      } as CreatorProfileEntity;
      jest.spyOn(creatorProfileRepository, 'findOne').mockResolvedValue(otherProfile);

      const first = await service.block('account-uuid', 'creator-uuid');
      const second = await service.block('account-uuid', 'creator-uuid');

      expect(first).toEqual({ blocked: true });
      expect(second).toEqual({ blocked: true });
      expect(creatorBlockRepository.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('unblock', () => {
    it('throws NotFoundException if creator profile does not exist', async () => {
      jest.spyOn(creatorProfileRepository, 'findOne').mockResolvedValue(null);

      await expect(service.unblock('account-uuid', 'creator-uuid'))
        .rejects.toThrow(NotFoundException);
    });

    it('removes a block if one exists, returning blocked: false', async () => {
      const otherProfile = {
        id: 'creator-uuid',
        accountId: 'other-account-uuid',
      } as CreatorProfileEntity;
      jest.spyOn(creatorProfileRepository, 'findOne').mockResolvedValue(otherProfile);

      const existingBlock = { id: 'block-uuid' } as CreatorBlockEntity;
      jest.spyOn(creatorBlockRepository, 'findOne').mockResolvedValue(existingBlock);
      jest.spyOn(creatorBlockRepository, 'remove').mockResolvedValue(existingBlock);

      const result = await service.unblock('account-uuid', 'creator-uuid');

      expect(result).toEqual({ blocked: false });
      expect(creatorBlockRepository.remove).toHaveBeenCalledWith(existingBlock);
    });

    it('is idempotent: returns blocked: false without calling remove if block does not exist', async () => {
      const otherProfile = {
        id: 'creator-uuid',
        accountId: 'other-account-uuid',
      } as CreatorProfileEntity;
      jest.spyOn(creatorProfileRepository, 'findOne').mockResolvedValue(otherProfile);
      jest.spyOn(creatorBlockRepository, 'findOne').mockResolvedValue(null);

      const result = await service.unblock('account-uuid', 'creator-uuid');

      expect(result).toEqual({ blocked: false });
      expect(creatorBlockRepository.remove).not.toHaveBeenCalled();
    });
  });

  describe('getBlockedCreators', () => {
    it('returns blocked creators sorted by createdAt DESC', async () => {
      const block1 = {
        id: 'b1',
        creatorProfile: {
          id: 'cp1',
          username: 'creator1',
          displayName: 'Creator One',
        },
      } as unknown as CreatorBlockEntity;
      const block2 = {
        id: 'b2',
        creatorProfile: {
          id: 'cp2',
          username: 'creator2',
          displayName: 'Creator Two',
        },
      } as unknown as CreatorBlockEntity;

      jest.spyOn(creatorBlockRepository, 'find').mockResolvedValue([block1, block2]);

      const result = await service.getBlockedCreators('account-uuid');

      expect(creatorBlockRepository.find).toHaveBeenCalledWith({
        where: { accountId: 'account-uuid' },
        relations: ['creatorProfile'],
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual([
        { id: 'cp1', username: 'creator1', displayName: 'Creator One' },
        { id: 'cp2', username: 'creator2', displayName: 'Creator Two' },
      ]);
    });
  });

  describe('hasBlocks', () => {
    it('returns true if count is greater than 0', async () => {
      jest.spyOn(creatorBlockRepository, 'count').mockResolvedValue(1);
      await expect(service.hasBlocks('account-uuid')).resolves.toBe(true);
    });

    it('returns false if count is 0', async () => {
      jest.spyOn(creatorBlockRepository, 'count').mockResolvedValue(0);
      await expect(service.hasBlocks('account-uuid')).resolves.toBe(false);
    });
  });
});
