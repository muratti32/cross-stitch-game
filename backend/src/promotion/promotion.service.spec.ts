import { PromotionService } from './promotion.service';
import { AppConfigService } from '../config/app-config.service';
import { GuestInstallationsRepository } from '../auth/guest-installations.repository';
import { AuthHashingService } from '../auth/auth-hashing.service';
import { FindOperator, IsNull, Repository } from 'typeorm';
import { PromotionLockEntity, PromotionTransferPackageEntity } from './entities';
import { AdAttemptEntity, CoinBalanceEntity, CoinLedgerEntryEntity, PatternUnlockEntity } from '../economy/entities';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PromotionPreviewDataDto } from './dto/promotion-preview.dto';
import { PatternLikeService } from '../social/pattern-like.service';
import { AccountStateService } from '../deletion/account-state.service';

const GUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

type PackageRow = Pick<PromotionTransferPackageEntity, 'guestId' | 'accountId' | 'status' | 'promotionMode'>;

/** In-memory promotion.transfer_packages honouring the equality and In() filters the service uses. */
function packageTable(initial: PackageRow[] = []) {
  const rows: PackageRow[] = [...initial];
  const matches = (row: PackageRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, expected]) => {
      const actual = row[key as keyof PackageRow];
      return expected instanceof FindOperator
        ? expected.type === 'in' && (expected.value as unknown[]).includes(actual)
        : actual === expected;
    });
  return {
    rows,
    findOne: async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null,
    count: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)).length,
    delete: async (where: Record<string, unknown>) => {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
    },
    insert: async (row: PackageRow) => {
      if (rows.some((r) => r.guestId === row.guestId)) throw Object.assign(new Error('duplicate key'), { code: '23505' });
      rows.push(row);
    },
  };
}

function expectPromotionError(promise: Promise<unknown>, status: number, code: string) {
  return expect(promise).rejects.toMatchObject({ status, response: { statusCode: status, code } });
}

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
  let managerSave: jest.Mock;
  let managerCount: jest.Mock;
  let transaction: jest.Mock;
  let packages: ReturnType<typeof packageTable>;
  let activeLock: PromotionLockEntity | null;
  let accountStateServiceMock: any;

  /** Counts for the preview's Guest unlocks and still-verifiable rewarded ads. */
  function setGuestCounts(unlocks: number, pendingAds: number) {
    managerCount.mockImplementation(async (entity: unknown, options: { where: Record<string, unknown> }) => {
      if (entity === PromotionTransferPackageEntity) return packages.count(options);
      if (entity === PatternUnlockEntity) return unlocks;
      if (entity === AdAttemptEntity) return pendingAds;
      return 0;
    });
  }

  function signedPreview(overrides: Partial<PromotionPreviewDataDto> = {}): { previewData: PromotionPreviewDataDto; signature: string } {
    const previewData: PromotionPreviewDataDto = {
      guestId: GUEST_ID,
      accountId: ACCOUNT_ID,
      manifestChecksum: 'checksum',
      promotionMode: 'economy',
      guestLedgerBalance: 0,
      expiry: new Date(Date.now() + 60_000).toISOString(),
      validatedPendingRewards: [],
      ...overrides,
    };
    return { previewData, signature: service['signPreview'](previewData) };
  }

  beforeEach(() => {
    packages = packageTable();
    activeLock = null;
    config = { jwtSecret: 'test-secret' } as any;
    authHashing = { verifyCredentialSecret: jest.fn() } as any;
    guestInstallationsRepo = { findOneById: jest.fn() } as any;
    lockRepo = { save: jest.fn(), delete: jest.fn(), findOne: jest.fn() } as any;
    transferPackageRepo = {
      save: jest.fn(),
      delete: jest.fn((where: Record<string, unknown>) => packages.delete(where)),
      count: jest.fn((options: { where: Record<string, unknown> }) => packages.count(options)),
      findOne: jest.fn((options: { where: Record<string, unknown> }) => packages.findOne(options)),
      insert: jest.fn((row: PackageRow) => packages.insert(row)),
    } as any;
    coinBalanceRepo = { findOne: jest.fn() } as any;
    coinLedgerEntryRepo = { findOne: jest.fn() } as any;
    patternLikeService = {
      likeWithManager: jest.fn(),
    } as any;

    managerFindOne = jest.fn();
    managerQuery = jest.fn().mockResolvedValue([]);
    managerSave = jest.fn();
    managerCount = jest.fn();
    setGuestCounts(0, 0);

    const routedFindOne = jest.fn(async (entity: unknown, options: { where: Record<string, unknown> }) => {
      if (entity === PromotionTransferPackageEntity) return packages.findOne(options);
      if (entity === PromotionLockEntity) return activeLock;
      return managerFindOne(entity, options);
    });

    transaction = jest.fn(async (isoOrWork: any, maybeWork?: any) => {
      const work = typeof isoOrWork === 'function' ? isoOrWork : maybeWork;
      return work({
        findOne: routedFindOne,
        find: jest.fn().mockResolvedValue([]),
        count: managerCount,
        save: managerSave,
        insert: jest.fn(),
        delete: jest.fn(),
        createQueryBuilder: jest.fn(),
        query: managerQuery,
      });
    });

    const dataSource = {
      // generatePreview() validates Pending Coin Rewards outside of a
      // transaction via `this.dataSource.manager` (validatePendingReward is
      // shared with commitPromotion's transactional manager) — expose the
      // same fakes here so both call sites are driven by these mocks.
      manager: {
        findOne: managerFindOne,
        query: managerQuery,
        count: managerCount,
      },
      transaction,
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
      const { previewData, signature } = signedPreview();
      jest.spyOn(lockRepo, 'save').mockImplementation(async (lock: any) => lock);

      const result = await service.acquireLock(ACCOUNT_ID, signature, previewData);
      expect(result.lockToken).toBeDefined();
    });

    it('rejects expired previews with preview_expired', async () => {
      const { previewData, signature } = signedPreview({ expiry: new Date(Date.now() - 5000).toISOString() });
      await expectPromotionError(service.acquireLock(ACCOUNT_ID, signature, previewData), 400, 'preview_expired');
    });

    it('rejects a modified preview with preview_invalid', async () => {
      const { previewData, signature } = signedPreview();
      await expectPromotionError(
        service.acquireLock(ACCOUNT_ID, signature, { ...previewData, guestLedgerBalance: 9999 }),
        400,
        'preview_invalid',
      );
    });
  });

  describe('preview inventory and economy slot', () => {
    const previewRequest = {
      guestId: GUEST_ID,
      guestCredential: 'secret',
      manifestChecksum: 'checksum',
      manifest: { progress: {}, completions: {}, likes: {}, pendingRewards: {} },
    };

    function guestWithStatus(status: 'active' | 'revoked') {
      jest.spyOn(guestInstallationsRepo, 'findOneById').mockResolvedValue({ id: GUEST_ID, status, credentialHash: 'hash' } as any);
    }

    beforeEach(() => {
      jest.spyOn(authHashing, 'verifyCredentialSecret').mockResolvedValue(true);
      jest.spyOn(coinBalanceRepo, 'findOne').mockResolvedValue({ balance: '40' } as any);
    });

    it("counts the Guest's Pattern Unlocks and rewarded ads still verifying", async () => {
      guestWithStatus('active');
      setGuestCounts(3, 2);

      const preview = await service.generatePreview(ACCOUNT_ID, previewRequest);

      expect(preview).toMatchObject({ promotionMode: 'economy', guestLedgerBalance: 40, guestUnlockCount: 3, pendingAdAttemptCount: 2 });
      expect(managerCount).toHaveBeenCalledWith(AdAttemptEntity, {
        where: { principalType: 'guest', principalId: GUEST_ID, consumedAt: IsNull(), expiresAt: expect.any(FindOperator) },
      });
    });

    it('rejects a revoked Guest with guest_consumed', async () => {
      guestWithStatus('revoked');
      await expectPromotionError(service.generatePreview(ACCOUNT_ID, previewRequest), 409, 'guest_consumed');
    });

    it('rejects a Guest whose package is committed even while revocation waits on commerce', async () => {
      guestWithStatus('active');
      packages.rows.push({ guestId: GUEST_ID, accountId: OTHER_ACCOUNT_ID, status: 'committed', promotionMode: 'economy' });
      await expectPromotionError(service.generatePreview(ACCOUNT_ID, previewRequest), 409, 'guest_consumed');
    });

    it('previews economy first and data-only once a needs_attention package holds the slot', async () => {
      guestWithStatus('active');
      await expect(service.generatePreview(ACCOUNT_ID, previewRequest)).resolves.toMatchObject({ promotionMode: 'economy' });

      packages.rows.push({ guestId: 'earlier-guest', accountId: ACCOUNT_ID, status: 'needs_attention', promotionMode: 'economy' });
      await expect(service.generatePreview(ACCOUNT_ID, previewRequest)).resolves.toMatchObject({
        promotionMode: 'data-only',
        dispositions: { coinBalance: 'discard', pendingRewards: 'discard' },
      });
    });
  });

  describe('commitPromotion', () => {
    function stageWithLock() {
      packages.rows.push({ guestId: GUEST_ID, accountId: ACCOUNT_ID, status: 'staged', promotionMode: null });
      activeLock = { guestId: GUEST_ID, token: 'lock-token', expiry: new Date(Date.now() + 60_000) } as PromotionLockEntity;
    }

    it('commits the first promotion as economy and records the mode on the package', async () => {
      stageWithLock();
      const { previewData, signature } = signedPreview();

      await expect(service.commitPromotion(ACCOUNT_ID, { previewData, signature })).resolves.toEqual({
        status: 'committed',
        promotionMode: 'economy',
        replayed: false,
      });
      expect(packages.rows[0]).toMatchObject({ status: 'committed', promotionMode: 'economy' });
    });

    it('rejects an economy preview with promotion_stale once a needs_attention package used the slot', async () => {
      packages.rows.push({ guestId: 'earlier-guest', accountId: ACCOUNT_ID, status: 'needs_attention', promotionMode: 'economy' });
      stageWithLock();
      const { previewData, signature } = signedPreview();

      await expectPromotionError(service.commitPromotion(ACCOUNT_ID, { previewData, signature }), 409, 'promotion_stale');
      expect(packages.rows.find((r) => r.guestId === GUEST_ID)).toMatchObject({ status: 'staged', promotionMode: null });
    });

    it('commits a data-only preview and expires the Guest rewarded ads still verifying', async () => {
      packages.rows.push({ guestId: 'earlier-guest', accountId: ACCOUNT_ID, status: 'committed', promotionMode: 'economy' });
      stageWithLock();
      const { previewData, signature } = signedPreview({ promotionMode: 'data-only' });

      await expect(service.commitPromotion(ACCOUNT_ID, { previewData, signature })).resolves.toEqual({
        status: 'committed',
        promotionMode: 'data-only',
        replayed: false,
      });
      expect(managerQuery).toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE economy\.ad_attempts\s+SET expires_at = now\(\)[\s\S]*consumed_at IS NULL/),
        [GUEST_ID],
      );
      expect(packages.rows.find((r) => r.guestId === GUEST_ID)).toMatchObject({ status: 'committed', promotionMode: 'data-only' });
    });

    it('does not discard rewarded ads on an economy commit', async () => {
      stageWithLock();
      const { previewData, signature } = signedPreview();
      await service.commitPromotion(ACCOUNT_ID, { previewData, signature });
      expect(managerQuery).not.toHaveBeenCalledWith(expect.stringContaining('economy.ad_attempts'), expect.anything());
    });

    it('replays a committed promotion without a lock or an unexpired preview', async () => {
      packages.rows.push({ guestId: GUEST_ID, accountId: ACCOUNT_ID, status: 'needs_attention', promotionMode: 'economy' });
      const { previewData, signature } = signedPreview({ expiry: new Date(Date.now() - 60_000).toISOString() });

      await expect(service.commitPromotion(ACCOUNT_ID, { previewData, signature })).resolves.toEqual({
        status: 'committed',
        promotionMode: 'economy',
        replayed: true,
      });
      expect(managerSave).not.toHaveBeenCalled();
    });

    it('rejects a Guest already committed to another account with guest_consumed', async () => {
      packages.rows.push({ guestId: GUEST_ID, accountId: OTHER_ACCOUNT_ID, status: 'committed', promotionMode: 'economy' });
      const { previewData, signature } = signedPreview();
      await expectPromotionError(service.commitPromotion(ACCOUNT_ID, { previewData, signature }), 409, 'guest_consumed');
    });

    it('still requires a valid signature on replay', async () => {
      packages.rows.push({ guestId: GUEST_ID, accountId: ACCOUNT_ID, status: 'committed', promotionMode: 'economy' });
      const { previewData } = signedPreview();
      await expectPromotionError(service.commitPromotion(ACCOUNT_ID, { previewData, signature: 'forged' }), 400, 'preview_invalid');
    });

    it('rejects an uncommitted promotion whose preview expired with preview_expired', async () => {
      stageWithLock();
      const { previewData, signature } = signedPreview({ expiry: new Date(Date.now() - 1000).toISOString() });
      await expectPromotionError(service.commitPromotion(ACCOUNT_ID, { previewData, signature }), 400, 'preview_expired');
    });

    it('rejects a commit without a live lock with promotion_lock_expired', async () => {
      stageWithLock();
      activeLock = null;
      const { previewData, signature } = signedPreview();
      await expectPromotionError(service.commitPromotion(ACCOUNT_ID, { previewData, signature }), 409, 'promotion_lock_expired');
    });

    it('retries when an in-flight ad grant holds the package row', async () => {
      stageWithLock();
      const { previewData, signature } = signedPreview();
      transaction.mockRejectedValueOnce(Object.assign(new Error('could not obtain lock'), { code: '55P03' }));

      await expect(service.commitPromotion(ACCOUNT_ID, { previewData, signature })).resolves.toMatchObject({ replayed: false });
      expect(transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('stagePackage and cancelPromotion', () => {
    const stageRequest = {
      guestId: GUEST_ID,
      lockToken: 'lock-token',
      manifestChecksum: 'checksum',
      packageData: { manifest: {} },
      checksum: 'package-checksum',
    };

    beforeEach(() => {
      jest.spyOn(lockRepo, 'findOne').mockResolvedValue({
        guestId: GUEST_ID,
        token: 'lock-token',
        expiry: new Date(Date.now() + 60_000),
      } as PromotionLockEntity);
    });

    it('refuses to replace a committed package with guest_consumed', async () => {
      packages.rows.push({ guestId: GUEST_ID, accountId: ACCOUNT_ID, status: 'committed', promotionMode: 'economy' });
      await expectPromotionError(service.stagePackage(ACCOUNT_ID, stageRequest), 409, 'guest_consumed');
      expect(packages.rows).toEqual([{ guestId: GUEST_ID, accountId: ACCOUNT_ID, status: 'committed', promotionMode: 'economy' }]);
    });

    it('replaces an earlier staged attempt', async () => {
      packages.rows.push({ guestId: GUEST_ID, accountId: OTHER_ACCOUNT_ID, status: 'staged', promotionMode: null });
      await expect(service.stagePackage(ACCOUNT_ID, stageRequest)).resolves.toMatchObject({ status: 'staged' });
      expect(packages.rows).toHaveLength(1);
      expect(packages.rows[0]).toMatchObject({ accountId: ACCOUNT_ID, status: 'staged' });
    });

    it('rejects staging without the live lock with promotion_lock_expired', async () => {
      jest.spyOn(lockRepo, 'findOne').mockResolvedValue(null);
      await expectPromotionError(service.stagePackage(ACCOUNT_ID, stageRequest), 409, 'promotion_lock_expired');
    });

    it('cancel deletes a staged package but never a committed one', async () => {
      packages.rows.push({ guestId: GUEST_ID, accountId: ACCOUNT_ID, status: 'staged', promotionMode: null });
      await service.cancelPromotion(ACCOUNT_ID, GUEST_ID);
      expect(packages.rows).toHaveLength(0);

      packages.rows.push({ guestId: GUEST_ID, accountId: ACCOUNT_ID, status: 'committed', promotionMode: 'economy' });
      await expect(service.cancelPromotion(ACCOUNT_ID, GUEST_ID)).resolves.toEqual({ status: 'cancelled' });
      expect(packages.rows).toHaveLength(1);
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

  describe('drainSession', () => {
    it('locks the Pattern and preserves a guest unlock when reassigning the session', async () => {
      jest.spyOn(transferPackageRepo, 'findOne').mockResolvedValue({
        status: 'committed',
      } as PromotionTransferPackageEntity);
      managerQuery
        .mockResolvedValueOnce([
          { id: 'guest-session', status: 'active', completed_at: null },
        ])
        .mockResolvedValueOnce([{ unlock_price_tier: 'medium' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ '?column?': 1 }]);

      await expect(
        service.drainSession(
          'account-uuid',
          'guest-uuid',
          'pattern-uuid',
          'guest-session',
        ),
      ).resolves.toEqual({ status: 'transferred', isLocked: false });

      expect(managerQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(
          'SELECT unlock_price_tier FROM catalog.patterns WHERE id = $1 FOR SHARE',
        ),
        ['pattern-uuid'],
      );
      expect(managerQuery).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining(
          "SELECT 'account', $1, pattern_id, source",
        ),
        ['account-uuid', 'guest-uuid', 'pattern-uuid'],
      );
      expect(managerQuery.mock.calls[2][0]).toContain(
        'ON CONFLICT ON CONSTRAINT "PK_pattern_unlocks" DO NOTHING',
      );
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
