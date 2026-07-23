import { PromotionService } from './promotion.service';
import { AppConfigService } from '../config/app-config.service';
import { GuestInstallationsRepository } from '../auth/guest-installations.repository';
import { AuthHashingService } from '../auth/auth-hashing.service';
import { Repository } from 'typeorm';
import { PromotionLockEntity, PromotionTransferPackageEntity } from './entities';
import { CoinBalanceEntity, CoinLedgerEntryEntity } from '../economy/entities';
import { NotFoundException, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';

describe('PromotionService', () => {
  let service: PromotionService;
  let config: AppConfigService;
  let authHashing: AuthHashingService;
  let guestInstallationsRepo: GuestInstallationsRepository;
  let lockRepo: Repository<PromotionLockEntity>;
  let transferPackageRepo: Repository<PromotionTransferPackageEntity>;
  let coinBalanceRepo: Repository<CoinBalanceEntity>;
  let coinLedgerEntryRepo: Repository<CoinLedgerEntryEntity>;

  beforeEach(() => {
    config = { jwtSecret: 'test-secret' } as any;
    authHashing = { verifyCredentialSecret: jest.fn() } as any;
    guestInstallationsRepo = { findOneById: jest.fn() } as any;
    lockRepo = { save: jest.fn(), delete: jest.fn(), findOne: jest.fn() } as any;
    transferPackageRepo = { save: jest.fn(), delete: jest.fn(), count: jest.fn(), findOne: jest.fn() } as any;
    coinBalanceRepo = { findOne: jest.fn() } as any;
    coinLedgerEntryRepo = { findOne: jest.fn() } as any;

    const dataSource = {
      transaction: jest.fn(async (isoOrWork: any, maybeWork?: any) => {
        const work = typeof isoOrWork === 'function' ? isoOrWork : maybeWork;
        return work({
          findOne: jest.fn(),
          count: jest.fn(),
          save: jest.fn(),
          insert: jest.fn(),
          createQueryBuilder: jest.fn(),
          query: jest.fn(),
        });
      }),
    } as any;

    service = new PromotionService(
      dataSource,
      config,
      authHashing,
      guestInstallationsRepo,
      lockRepo,
      transferPackageRepo,
      coinBalanceRepo,
      coinLedgerEntryRepo,
    );
  });

  describe('generatePreview', () => {
    it('authenticates guest and checks promotion mode', async () => {
      const guestId = 'guest-uuid';
      const accountId = 'account-uuid';
      const guest = { id: guestId, status: 'active', credentialHash: 'hash' };
      
      jest.spyOn(guestInstallationsRepo, 'findOneById').mockResolvedValue(guest as any);
      jest.spyOn(authHashing, 'verifyCredentialSecret').mockResolvedValue(true);
      jest.spyOn(transferPackageRepo, 'count').mockResolvedValue(0);
      jest.spyOn(coinBalanceRepo, 'findOne').mockResolvedValue({ balance: 50 } as any);
      jest.spyOn(coinLedgerEntryRepo, 'findOne').mockResolvedValue(null);

      const result = await service.generatePreview(accountId, {
        guestId,
        guestCredential: 'password',
        manifestChecksum: 'checksum',
        manifest: {
          progress: {},
          completions: {},
          likes: {},
          pendingRewards: {
            'daily_task:123': {}
          }
        }
      });

      expect(result.guestId).toBe(guestId);
      expect(result.accountId).toBe(accountId);
      expect(result.promotionMode).toBe('economy');
      expect(result.guestLedgerBalance).toBe(50);
      expect(result.validatedPendingRewards).toContain('daily_task:123');
      expect(result.signature).toBeDefined();
    });

    it('rejects already granted rewards', async () => {
      const guestId = 'guest-uuid';
      const accountId = 'account-uuid';
      const guest = { id: guestId, status: 'active', credentialHash: 'hash' };
      
      jest.spyOn(guestInstallationsRepo, 'findOneById').mockResolvedValue(guest as any);
      jest.spyOn(authHashing, 'verifyCredentialSecret').mockResolvedValue(true);
      jest.spyOn(transferPackageRepo, 'count').mockResolvedValue(0);
      jest.spyOn(coinBalanceRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(coinLedgerEntryRepo, 'findOne').mockResolvedValue({ id: 'existing' } as any);

      const result = await service.generatePreview(accountId, {
        guestId,
        guestCredential: 'password',
        manifestChecksum: 'checksum',
        manifest: {
          progress: {},
          completions: {},
          likes: {},
          pendingRewards: {
            'daily_task:123': {}
          }
        }
      });

      expect(result.validatedPendingRewards).toHaveLength(0);
      expect(result.rejectedPendingRewards['daily_task:123']).toBe('already_granted');
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
});
