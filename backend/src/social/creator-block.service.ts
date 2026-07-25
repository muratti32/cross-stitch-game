import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatorBlockEntity } from './entities/creator-block.entity';
import { CreatorProfileEntity } from '../creator-profile/entities/creator-profile.entity';

@Injectable()
export class CreatorBlockService {
  constructor(
    @InjectRepository(CreatorBlockEntity)
    private readonly creatorBlockRepository: Repository<CreatorBlockEntity>,
    @InjectRepository(CreatorProfileEntity)
    private readonly creatorProfileRepository: Repository<CreatorProfileEntity>,
  ) {}

  async block(accountId: string, creatorProfileId: string): Promise<{ blocked: boolean }> {
    const creatorProfile = await this.creatorProfileRepository.findOne({
      where: { id: creatorProfileId },
    });
    if (!creatorProfile) {
      throw new NotFoundException(`Creator profile with ID ${creatorProfileId} not found`);
    }

    if (creatorProfile.accountId === accountId) {
      throw new BadRequestException('You cannot block your own creator profile');
    }

    // Concurrent block taps from two devices must not surface a unique
    // violation: the relationship is what matters, not which request wrote it.
    await this.creatorBlockRepository.upsert(
      { accountId, creatorProfileId },
      {
        conflictPaths: ['accountId', 'creatorProfileId'],
        skipUpdateIfNoValuesChanged: true,
      },
    );

    return { blocked: true };
  }

  async unblock(accountId: string, creatorProfileId: string): Promise<{ blocked: boolean }> {
    const creatorProfile = await this.creatorProfileRepository.findOne({
      where: { id: creatorProfileId },
    });
    if (!creatorProfile) {
      throw new NotFoundException(`Creator profile with ID ${creatorProfileId} not found`);
    }

    const existingBlock = await this.creatorBlockRepository.findOne({
      where: { accountId, creatorProfileId },
    });

    if (existingBlock) {
      await this.creatorBlockRepository.remove(existingBlock);
    }

    return { blocked: false };
  }

  async getBlockedCreators(accountId: string) {
    const blocks = await this.creatorBlockRepository.find({
      where: { accountId },
      relations: ['creatorProfile'],
      order: { createdAt: 'DESC' },
    });

    return blocks.map((block) => ({
      id: block.creatorProfile.id,
      username: block.creatorProfile.username,
      displayName: block.creatorProfile.displayName,
    }));
  }

  async getBlockedCreatorProfileIdsForAccount(accountId: string): Promise<string[]> {
    const blocks = await this.creatorBlockRepository.find({
      select: ['creatorProfileId'],
      where: { accountId },
    });
    return blocks.map((b) => b.creatorProfileId);
  }

  async hasBlocks(accountId: string): Promise<boolean> {
    const count = await this.creatorBlockRepository.count({
      where: { accountId },
    });
    return count > 0;
  }
}

