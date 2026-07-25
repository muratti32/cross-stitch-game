import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Repository } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import type { ObjectStorage } from '../catalog/storage/object-storage.interface';
import { CreatorProfileService } from './creator-profile.service';
import { CreatorProfileEntity } from './entities';
import type { ProfileSafetyService } from './profile-safety.service';
import type { ProfileTextPolicyService } from './profile-text-policy.service';

describe('CreatorProfileService - Account Closure Hold', () => {
  let service: CreatorProfileService;
  let profilesRepository: Repository<CreatorProfileEntity>;
  let mockStorage: ObjectStorage;

  const heldProfile: CreatorProfileEntity = {
    id: 'profile-id-held',
    accountId: 'account-id-held',
    username: 'held_creator',
    displayName: 'Held Creator display name',
    avatarObjectKey: 'avatar-key',
    avatarContentType: 'image/png',
    avatarChecksum: 'checksum',
    version: 1,
    restrictedAt: null,
    closureHoldAt: new Date('2026-07-25T10:00:00Z'),
    createdAt: new Date('2026-07-25T09:00:00Z'),
    updatedAt: new Date('2026-07-25T09:00:00Z'),
  };

  const activeProfile: CreatorProfileEntity = {
    id: 'profile-id-active',
    accountId: 'account-id-active',
    username: 'active_creator',
    displayName: 'Active Creator display name',
    avatarObjectKey: 'avatar-key',
    avatarContentType: 'image/png',
    avatarChecksum: 'checksum',
    version: 1,
    restrictedAt: null,
    closureHoldAt: null,
    createdAt: new Date('2026-07-25T09:00:00Z'),
    updatedAt: new Date('2026-07-25T09:00:00Z'),
  };

  const restrictedProfile: CreatorProfileEntity = {
    id: 'profile-id-restricted',
    accountId: 'account-id-restricted',
    username: 'restricted_creator',
    displayName: 'Restricted Creator display name',
    avatarObjectKey: 'avatar-key',
    avatarContentType: 'image/png',
    avatarChecksum: 'checksum',
    version: 1,
    restrictedAt: new Date('2026-07-25T10:00:00Z'),
    closureHoldAt: null,
    createdAt: new Date('2026-07-25T09:00:00Z'),
    updatedAt: new Date('2026-07-25T09:00:00Z'),
  };

  beforeEach(() => {
    profilesRepository = {
      findOneBy: jest.fn().mockImplementation((where: { id?: string; accountId?: string }) => {
        if (where.id === 'profile-id-held' || where.accountId === 'account-id-held') {
          return Promise.resolve(heldProfile);
        }
        if (where.id === 'profile-id-active' || where.accountId === 'account-id-active') {
          return Promise.resolve(activeProfile);
        }
        if (where.id === 'profile-id-restricted' || where.accountId === 'account-id-restricted') {
          return Promise.resolve(restrictedProfile);
        }
        return Promise.resolve(null);
      }),
    } as unknown as Repository<CreatorProfileEntity>;

    mockStorage = {
      get: jest.fn().mockResolvedValue(Buffer.from('avatar-data')),
    } as unknown as ObjectStorage;

    const mockDataSource = {} as unknown as DataSource;
    service = new CreatorProfileService(
      mockDataSource,
      profilesRepository,
      mockStorage,
      {} as unknown as ProfileSafetyService,
      {} as unknown as ProfileTextPolicyService,
    );
  });

  describe('getPublic', () => {
    it('throws NotFoundException when creator profile is under closure hold', async () => {
      await expect(service.getPublic('profile-id-held')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the public view when creator profile is active (not held)', async () => {
      const result = await service.getPublic('profile-id-active');
      expect(result).toEqual({
        id: 'profile-id-active',
        username: 'active_creator',
        displayName: 'Active Creator display name',
        avatarUrl: '/v1/creator-profiles/profile-id-active/avatar?v=1',
        restricted: false,
        createdAt: '2026-07-25T09:00:00.000Z',
        updatedAt: '2026-07-25T09:00:00.000Z',
      });
      // Verify publicView doesn't return closureHold
      expect((result as Record<string, unknown>).closureHold).toBeUndefined();
    });

    it('masks identity in public view for a restricted profile', async () => {
      const result = await service.getPublic('profile-id-restricted');
      expect(result).toEqual({
        id: 'profile-id-restricted',
        username: 'restricted_creator',
        displayName: 'Restricted Creator',
        avatarUrl: null,
        restricted: true,
        createdAt: '2026-07-25T09:00:00.000Z',
        updatedAt: '2026-07-25T09:00:00.000Z',
      });
      expect((result as Record<string, unknown>).closureHold).toBeUndefined();
    });
  });

  describe('getMine', () => {
    it('returns the private view with closureHold: true when owner profile is held', async () => {
      const principal: AuthPrincipal = {
        id: 'account-id-held',
        tokenVersion: 1,
        type: PrincipalType.Account,
      };
      const result = await service.getMine(principal);
      expect(result).toEqual({
        id: 'profile-id-held',
        username: 'held_creator',
        displayName: 'Held Creator display name',
        avatarUrl: '/v1/creator-profiles/profile-id-held/avatar?v=1',
        restricted: false,
        closureHold: true,
        createdAt: '2026-07-25T09:00:00.000Z',
        updatedAt: '2026-07-25T09:00:00.000Z',
      });
    });

    it('returns the private view with closureHold: false when owner profile is active', async () => {
      const principal: AuthPrincipal = {
        id: 'account-id-active',
        tokenVersion: 1,
        type: PrincipalType.Account,
      };
      const result = await service.getMine(principal);
      expect(result).toEqual({
        id: 'profile-id-active',
        username: 'active_creator',
        displayName: 'Active Creator display name',
        avatarUrl: '/v1/creator-profiles/profile-id-active/avatar?v=1',
        restricted: false,
        closureHold: false,
        createdAt: '2026-07-25T09:00:00.000Z',
        updatedAt: '2026-07-25T09:00:00.000Z',
      });
    });
  });

  describe('getAvatar', () => {
    it('throws NotFoundException when creator profile is under closure hold', async () => {
      await expect(service.getAvatar('profile-id-held')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the avatar bytes and content type when creator profile is active', async () => {
      const result = await service.getAvatar('profile-id-active');
      expect(result).toEqual({
        bytes: Buffer.from('avatar-data'),
        contentType: 'image/png',
      });
    });

    it('throws NotFoundException when creator profile is restricted', async () => {
      await expect(service.getAvatar('profile-id-restricted')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
