import { PromotionService } from './promotion.service';
import { AppConfigService } from '../config/app-config.service';
import { GuestInstallationsRepository } from '../auth/guest-installations.repository';
import { AuthHashingService } from '../auth/auth-hashing.service';
import { Repository } from 'typeorm';
import { PromotionLockEntity, PromotionTransferPackageEntity } from './entities';
import { CoinBalanceEntity, CoinLedgerEntryEntity } from '../economy/entities';
import { NotFoundException, UnauthorizedException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PatternLikeService } from '../social/pattern-like.service';
import { AccountStateService } from '../deletion/account-state.service';

describe('PromotionService', () => {
  let service: PromotionService;
  let config: AppConfigService;
  let authHashing: AuthHashingService;
  let guestInstallationsRepo: GuestInstallationsRepository;
  let lockRepo: Repository<PromotionLockEntity>;
  let transferPackageRepo: Repository<PromotionTransferPackageEntity>;
  let coinBalanceRepo: Repository<CoinBalanceEntity>;
  let coinLedgerEntryRepo: Repository<CoinLedgerEntryEntity>;
  let patternLikeService: PatternLikeService;
  let managerFindOne: jest.Mock;
  let managerQuery: jest.Mock;
  let accountStateServiceMock: any;

  beforeEach(() => {
    config = { jwtSecret: 'test-secret' } as any;
    authHashing = { verifyCredentialSecret: jest.fn() } as any;
    guestInstallationsRepo = { findOneById: jest.fn() } as any;
    lockRepo = { save: jest.fn(), delete: jest.fn(), findOne: jest.fn() } as any;
    transferPackageRepo = { save: jest.fn(), delete: jest.fn(), count: jest.fn(), findOne: jest.fn() } as any;
    coinBalanceRepo = { findOne: jest.fn() } as any;
    coinLedgerEntryRepo = { findOne: jest.fn() } as any;
    patternLikeService = {
      likeWithManager: jest.fn(),
    } as any;

    managerFindOne = jest.fn();
    managerQuery = jest.fn();

    const dataSource = {
      // generatePreview() validates Pending Coin Rewards outside of a
      // transaction via `this.dataSource.manager` (validatePendingReward is
      // shared with commitPromotion's transactional manager) — expose the
      // same fakes here so both call sites are driven by these mocks.
      manager: {
        findOne: managerFindOne,
        query: managerQuery,
      },
      transaction: jest.fn(async (isoOrWork: any, maybeWork?: any) => {
        const work = typeof isoOrWork === 'function' ? isoOrWork : maybeWork;
        return work({
          findOne: managerFindOne,
          count: jest.fn(),
          save: jest.fn(),
          insert: jest.fn(),
          createQueryBuilder: jest.fn(),
          query: managerQuery,
        });
      }),
    } as any;

    accountStateServiceMock = {
      getAccountStatus: jest.fn().mockResolvedValue('active'),
    };

    service = new PromotionService(
      patternLikeService,
      dataSource,
      config,
      authHashing,
      guestInstallationsRepo,
      lockRepo,
      transferPackageRepo,
      coinBalanceRepo,
      coinLedgerEntryRepo,
      accountStateServiceMock as AccountStateService,
    );
  });

  describe('generatePreview', () => {
    it('authenticates guest and checks promotion mode', async () => {
      const guestId = 'guest-uuid';
      const accountId = 'account-uuid';
      const guest = { id: guestId, status: 'active', credentialHash: 'hash' };
      const sourceKey = `daily_task:guest:${guestId}:2026-01-01:cells_100`;

      jest.spyOn(guestInstallationsRepo, 'findOneById').mockResolvedValue(guest as any);
      jest.spyOn(authHashing, 'verifyCredentialSecret').mockResolvedValue(true);
      jest.spyOn(transferPackageRepo, 'count').mockResolvedValue(0);
      jest.spyOn(coinBalanceRepo, 'findOne').mockResolvedValue({ balance: 50 } as any);
      // Not already granted, and the guest's own recorded progress meets the
      // cells_100 threshold — so this pending reward validates for real.
      managerFindOne.mockResolvedValue(null);
      managerQuery
        .mockResolvedValueOnce([{ action_count: 100 }]) // daily_color_action_counts
        .mockResolvedValueOnce([{ exists: false }]); // gameplay_events color_completion check

      const result = await service.generatePreview(accountId, {
        guestId,
        guestCredential: 'password',
        manifestChecksum: 'checksum',
        manifest: {
          progress: {},
          completions: {},
          likes: {},
          pendingRewards: {
            [sourceKey]: {}
          }
        }
      });

      expect(result.guestId).toBe(guestId);
      expect(result.accountId).toBe(accountId);
      expect(result.promotionMode).toBe('economy');
      expect(result.guestLedgerBalance).toBe(50);
      expect(result.validatedPendingRewards).toContain(sourceKey);
      expect(result.signature).toBeDefined();
    });

    it('rejects already granted rewards', async () => {
      const guestId = 'guest-uuid';
      const accountId = 'account-uuid';
      const guest = { id: guestId, status: 'active', credentialHash: 'hash' };
      const sourceKey = `daily_task:guest:${guestId}:2026-01-01:cells_100`;

      jest.spyOn(guestInstallationsRepo, 'findOneById').mockResolvedValue(guest as any);
      jest.spyOn(authHashing, 'verifyCredentialSecret').mockResolvedValue(true);
      jest.spyOn(transferPackageRepo, 'count').mockResolvedValue(0);
      jest.spyOn(coinBalanceRepo, 'findOne').mockResolvedValue(null);
      managerFindOne.mockResolvedValue({ id: 'existing' } as any);

      const result = await service.generatePreview(accountId, {
        guestId,
        guestCredential: 'password',
        manifestChecksum: 'checksum',
        manifest: {
          progress: {},
          completions: {},
          likes: {},
          pendingRewards: {
            [sourceKey]: {}
          }
        }
      });

      expect(result.validatedPendingRewards).toHaveLength(0);
      expect(result.rejectedPendingRewards[sourceKey]).toBe('already_granted');
    });

    it('rejects a pending reward whose sourceKey does not belong to the promoting guest', async () => {
      const guestId = 'guest-uuid';
      const accountId = 'account-uuid';
      const guest = { id: guestId, status: 'active', credentialHash: 'hash' };
      const fabricatedKey = 'daily_task:guest:someone-elses-guest-id:2026-01-01:cells_100';

      jest.spyOn(guestInstallationsRepo, 'findOneById').mockResolvedValue(guest as any);
      jest.spyOn(authHashing, 'verifyCredentialSecret').mockResolvedValue(true);
      jest.spyOn(transferPackageRepo, 'count').mockResolvedValue(0);
      jest.spyOn(coinBalanceRepo, 'findOne').mockResolvedValue(null);
      managerFindOne.mockResolvedValue(null);

      const result = await service.generatePreview(accountId, {
        guestId,
        guestCredential: 'password',
        manifestChecksum: 'checksum',
        manifest: {
          progress: {},
          completions: {},
          likes: {},
          pendingRewards: {
            [fabricatedKey]: {}
          }
        }
      });

      expect(result.validatedPendingRewards).toHaveLength(0);
      expect(result.rejectedPendingRewards[fabricatedKey]).toBe('ownership_mismatch');
    });

    it('reverts to data-only promotion if account already had economy promotion', async () => {
      const guestId = 'guest-uuid';
      const accountId = 'account-uuid';
      const guest = { id: guestId, status: 'active', credentialHash: 'hash' };
      
      jest.spyOn(guestInstallationsRepo, 'findOneById').mockResolvedValue(guest as any);
      jest.spyOn(authHashing, 'verifyCredentialSecret').mockResolvedValue(true);
      jest.spyOn(transferPackageRepo, 'count').mockResolvedValue(1);
      jest.spyOn(coinBalanceRepo, 'findOne').mockResolvedValue({ balance: 50 } as any);

      const result = await service.generatePreview(accountId, {
        guestId,
        guestCredential: 'password',
        manifestChecksum: 'checksum',
        manifest: { progress: {}, completions: {}, likes: {}, pendingRewards: {} }
      });

      expect(result.promotionMode).toBe('data-only');
      expect(result.dispositions.coinBalance).toBe('discard');
    });
  });

  describe('acquireLock', () => {
    it('verifies signature and creates a short-lived lock', async () => {
      const guestId = 'guest-uuid';
      const accountId = 'account-uuid';
      const expiry = new Date(Date.now() + 5000).toISOString();
      const previewData = { guestId, accountId, expiry };
      const signature = (service as any).signData(previewData);

      jest.spyOn(lockRepo, 'save').mockImplementation(async (lock: any) => {
        lock.token = 'lock-token';
        return lock as any;
      });

      const result = await service.acquireLock(accountId, signature, previewData);
      expect(result.lockToken).toBeDefined();
    });

    it('rejects expired previews', async () => {
      const guestId = 'guest-uuid';
      const accountId = 'account-uuid';
      const expiry = new Date(Date.now() - 5000).toISOString();
      const previewData = { guestId, accountId, expiry };
      const signature = (service as any).signData(previewData);

      await expect(service.acquireLock(accountId, signature, previewData))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('assertNotLocked', () => {
    it('passes for account principal', async () => {
      await expect(service.assertNotLocked('id', 'account')).resolves.toBeUndefined();
    });

    it('passes if guest is not locked', async () => {
      jest.spyOn(lockRepo, 'findOne').mockResolvedValue(null);
      await expect(service.assertNotLocked('id', 'guest')).resolves.toBeUndefined();
    });

    it('throws if guest is locked and lock has not expired', async () => {
      jest.spyOn(lockRepo, 'findOne').mockResolvedValue({
        guestId: 'id',
        expiry: new Date(Date.now() + 5000)
      } as any);

      await expect(service.assertNotLocked('id', 'guest'))
        .rejects.toThrow(ConflictException);
    });

    it('passes if lock has expired', async () => {
      jest.spyOn(lockRepo, 'findOne').mockResolvedValue({
        guestId: 'id',
        expiry: new Date(Date.now() - 5000)
      } as any);

      await expect(service.assertNotLocked('id', 'guest')).resolves.toBeUndefined();
    });
  });

  describe('drainLike', () => {
    it('throws ForbiddenException if package is not found or not committed', async () => {
      jest.spyOn(transferPackageRepo, 'findOne').mockResolvedValue(null);
      await expect(service.drainLike('account-uuid', 'guest-uuid', 'pattern-uuid'))
        .rejects.toThrow(ForbiddenException);
    });

    it('returns discarded if pattern does not exist, is personal, or is not available', async () => {
      jest.spyOn(transferPackageRepo, 'findOne').mockResolvedValue({ status: 'committed' } as unknown as PromotionTransferPackageEntity);

      // Pattern not found
      managerFindOne.mockResolvedValueOnce(null);
      let result = await service.drainLike('account-uuid', 'guest-uuid', 'pattern-uuid');
      expect(result).toEqual({ status: 'discarded' });

      // Pattern is personal
      managerFindOne.mockResolvedValueOnce({ visibility: 'personal', status: 'available' });
      result = await service.drainLike('account-uuid', 'guest-uuid', 'pattern-uuid');
      expect(result).toEqual({ status: 'discarded' });

      // Pattern status is not available
      managerFindOne.mockResolvedValueOnce({ visibility: 'catalog', status: 'withdrawn' });
      result = await service.drainLike('account-uuid', 'guest-uuid', 'pattern-uuid');
      expect(result).toEqual({ status: 'discarded' });
    });

    it('applies the like and returns status applied if not already liked', async () => {
      jest.spyOn(transferPackageRepo, 'findOne').mockResolvedValue({ status: 'committed' } as unknown as PromotionTransferPackageEntity);
      managerFindOne.mockResolvedValueOnce({ visibility: 'catalog', status: 'available' });
      jest.spyOn(patternLikeService, 'likeWithManager').mockResolvedValueOnce({ liked: true, likeCount: 1, wasInserted: true });

      const result = await service.drainLike('account-uuid', 'guest-uuid', 'pattern-uuid');
      expect(result).toEqual({ status: 'applied' });
      expect(patternLikeService.likeWithManager).toHaveBeenCalled();
    });

    it('does not double-increment if drain is replayed (returns already_present)', async () => {
      jest.spyOn(transferPackageRepo, 'findOne').mockResolvedValue({ status: 'committed' } as unknown as PromotionTransferPackageEntity);
      managerFindOne.mockResolvedValueOnce({ visibility: 'catalog', status: 'available' });
      jest.spyOn(patternLikeService, 'likeWithManager').mockResolvedValueOnce({ liked: true, likeCount: 1, wasInserted: false });

      const result = await service.drainLike('account-uuid', 'guest-uuid', 'pattern-uuid');
      expect(result).toEqual({ status: 'already_present' });
    });

    it('returns already_present and does not increment if the account already liked the pattern', async () => {
      jest.spyOn(transferPackageRepo, 'findOne').mockResolvedValue({ status: 'committed' } as unknown as PromotionTransferPackageEntity);
      managerFindOne.mockResolvedValueOnce({ visibility: 'catalog', status: 'available' });
      jest.spyOn(patternLikeService, 'likeWithManager').mockResolvedValueOnce({ liked: true, likeCount: 5, wasInserted: false });

      const result = await service.drainLike('account-uuid', 'guest-uuid', 'pattern-uuid');
      expect(result).toEqual({ status: 'already_present' });
    });
  });

  describe('mayRevokeGuest', () => {
    it('protects a guest when any commerce source remains', async () => {
      managerQuery.mockResolvedValue([{ safe: false }]);
      await expect((service as any).mayRevokeGuest(
        { query: managerQuery }, 'guest-uuid', 'account-uuid',
      )).resolves.toBe(false);
      expect(managerQuery.mock.calls[0][0]).toContain('membership_periods');
      expect(managerQuery.mock.calls[0][0]).toContain('commerce_transaction_bindings');
    });

    it('allows revocation only after all sources are empty or acknowledged', async () => {
      managerQuery.mockResolvedValue([{ safe: true }]);
      await expect((service as any).mayRevokeGuest(
        { query: managerQuery }, 'guest-uuid', 'account-uuid',
      )).resolves.toBe(true);
    });
  });
});
