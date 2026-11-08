import { PromotionService } from './promotion.service';
import { AppConfigService } from '../config/app-config.service';
import { GuestInstallationsRepository } from '../auth/guest-installations.repository';
import { AuthHashingService } from '../auth/auth-hashing.service';
import { FindOperator, IsNull, Repository } from 'typeorm';
import { PromotionLockEntity, PromotionTransferPackageEntity } from './entities';
import { AdAttemptEntity, CoinBalanceEntity, CoinLedgerEntryEntity, PatternUnlockEntity } from '../economy/entities';
import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
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
      update: jest.fn(),
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

    it('rejects malformed packaged sessions with package_invalid and keeps the earlier attempt', async () => {
      packages.rows.push({ guestId: GUEST_ID, accountId: ACCOUNT_ID, status: 'staged', promotionMode: null });
      const malformed = { ...stageRequest, packageData: { manifest: {}, sessions: [{ key: 'session-1' }] } };

      await expectPromotionError(service.stagePackage(ACCOUNT_ID, malformed), 400, 'package_invalid');
      expect(packages.rows).toEqual([{ guestId: GUEST_ID, accountId: ACCOUNT_ID, status: 'staged', promotionMode: null }]);
    });

    it('stages a package carrying sessions and keeps its data verbatim', async () => {
      const session = { key: 'session-1', status: 'active', completedAt: null, packedBitmapBase64: 'BQ==', title: 'Cat' };
      const packageData = { manifest: {}, sessions: [session] };

      await expect(service.stagePackage(ACCOUNT_ID, { ...stageRequest, packageData })).resolves.toMatchObject({ status: 'staged' });
      expect(packages.rows[0]).toMatchObject({ packageData });
    });

    it('stages a package without sessions as before', async () => {
      await expect(service.stagePackage(ACCOUNT_ID, stageRequest)).resolves.toMatchObject({ status: 'staged' });
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

  describe('first completion pending reward', () => {
    const guestId = '11111111-1111-4111-8111-111111111111';
    const patternId = '22222222-2222-4222-8222-222222222222';
    const sourceKey = `first_completion:guest:${guestId}:${patternId}`;

    function validate(stitchableCellCount: number | null) {
      managerQuery
        .mockResolvedValueOnce([{ width: 100, height: 100, stitchableCellCount, visibility: 'catalog' }])
        .mockResolvedValueOnce([{ exists: true }]);
      managerFindOne.mockResolvedValue(null);
      return (service as any).validatePendingReward(
        (service as any).dataSource.manager,
        guestId,
        sourceKey,
      );
    }

    it('prices a sparse Pattern by its stitchable cells', async () => {
      await expect(validate(114)).resolves.toMatchObject({ valid: true, amount: 25 });
    });

    it('prices a row with no stitchable count by width × height', async () => {
      await expect(validate(null)).resolves.toMatchObject({ valid: true, amount: 60 });
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
    const GUEST_SESSION = '44444444-4444-4444-8444-444444444444';
    const ACCOUNT_SESSION = '55555555-5555-4555-8555-555555555555';
    const PATTERN = '66666666-6666-4666-8666-666666666666';

    type SessionRow = { id: string; status: 'active' | 'completed' };
    type SqlRoute = [RegExp, (params: unknown[]) => unknown[]];

    let guestSessions: SessionRow[];
    let accountSessions: SessionRow[];
    let accountSessionById: Record<string, SessionRow>;
    let completedCellCount: number;
    let stitchableCellCount: number | null;
    let locked: boolean;
    let accountCompleted: boolean;

    function packagedSession(overrides: Record<string, unknown> = {}) {
      return {
        key: GUEST_SESSION,
        status: 'active',
        completedAt: null,
        packedBitmapBase64: Buffer.from([0b0000_0101]).toString('base64'),
        ...overrides,
      };
    }

    function consumedPackage(status: 'committed' | 'needs_attention', sessions?: unknown[]) {
      const row = { guestId: GUEST_ID, accountId: ACCOUNT_ID, status, promotionMode: 'economy', packageData: { manifest: {}, sessions } };
      packages.rows.push(row as PackageRow);
      return row;
    }

    function drain() {
      return service.drainSession(ACCOUNT_ID, GUEST_ID, PATTERN, GUEST_SESSION);
    }

    function statements(pattern: RegExp) {
      return managerQuery.mock.calls.filter(([sql]: [string]) => pattern.test(sql));
    }

    const WRITES = /^\s*(INSERT|UPDATE|DELETE|WITH)/;

    beforeEach(() => {
      guestSessions = [];
      accountSessions = [];
      accountSessionById = {};
      completedCellCount = 0;
      stitchableCellCount = null;
      locked = false;
      accountCompleted = false;
      const routes: SqlRoute[] = [
        [/principal_type = 'guest' AND principal_id = \$2 AND pattern_id = \$3/, () => guestSessions],
        [/FROM catalog\.patterns WHERE id = \$1 FOR SHARE/, () => [{ width: 2, height: 2, stitchableCellCount }]],
        [/AND pattern_id = \$2\s+ORDER BY/, () => accountSessions],
        [/\(id = \$2 OR pattern_id = \$3\)/, (params) => {
          const byId = accountSessionById[params[1] as string];
          return byId ? [byId] : accountSessions.slice(0, 1);
        }],
        [/AS locked/, () => [{ locked }]],
        [/status = 'completed'\s+LIMIT 1/, () => accountCompleted ? [{ '?column?': 1 }] : []],
        [/AS completed\b/, () => [{ completed: String(completedCellCount) }]],
        [/AS total_cells/, () => [{ revision: '7', terminal: false, total_cells: 4, completed_cells: [0, 2] }]],
        [/AS max_rev/, () => [{ max_rev: '0' }]],
      ];
      managerQuery.mockImplementation(async (sql: string, params: unknown[]) => {
        const route = routes.find(([pattern]) => pattern.test(sql));
        return route ? route[1](params) : [];
      });
    });

    const survivingProgress = {
      revision: 7,
      packedBitmapBase64: Buffer.from([0b0000_0101]).toString('base64'),
      terminalCompleted: false,
      isLocked: false,
    };

    it('moves the Guest session to an account with no session and applies its bitmap', async () => {
      consumedPackage('committed', [packagedSession()]);
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];

      await expect(drain()).resolves.toEqual({
        status: 'transferred',
        accountSessionId: GUEST_SESSION,
        ...survivingProgress,
      });

      expect(statements(/SET principal_type = 'account'/)[0][1]).toEqual([ACCOUNT_ID, GUEST_SESSION]);
      expect(statements(/unnest\(\$3::int\[\]\)/)[0][1]).toEqual([GUEST_SESSION, GUEST_ID, [0, 2]]);
      expect(statements(/session_progress_flags/)[0][1]).toEqual([GUEST_SESSION]);
    });

    it('takes the session lock before writing cells', async () => {
      consumedPackage('committed', [packagedSession()]);
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];

      await drain();

      const order = managerQuery.mock.calls.map(([sql]: [string]) => sql);
      const lock = order.findIndex((sql: string) => sql.includes('pg_advisory_xact_lock'));
      const write = order.findIndex((sql: string) => sql.includes('unnest($3::int[])'));
      expect(lock).toBeGreaterThanOrEqual(0);
      expect(lock).toBeLessThan(write);
    });

    it('grants the Pattern Chart Entitlement with source promotion when a completed session moves to the account', async () => {
      consumedPackage('committed', [packagedSession({ status: 'completed' })]);
      guestSessions = [{ id: GUEST_SESSION, status: 'completed' }];
      accountCompleted = true;

      await drain();

      const grants = statements(/pattern_chart_entitlements/) as [string, unknown[]][];
      expect(grants).toHaveLength(1);
      expect(grants[0][1]).toEqual([ACCOUNT_ID, PATTERN, 'promotion']);
    });

    it('grants regardless of promotion mode or Promotion-Locked state', async () => {
      const row = consumedPackage('committed', [packagedSession({ status: 'completed' })]);
      row.promotionMode = 'data-only';
      guestSessions = [{ id: GUEST_SESSION, status: 'completed' }];
      accountCompleted = true;
      locked = true;

      await expect(drain()).resolves.toMatchObject({ isLocked: true });

      expect(statements(/pattern_chart_entitlements/)).toHaveLength(1);
    });

    it('does not grant while the moved session is still active', async () => {
      consumedPackage('committed', [packagedSession()]);
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];

      await drain();

      expect(statements(/pattern_chart_entitlements/)).toHaveLength(0);
    });

    it('grants on the acknowledged retry path after the session already moved', async () => {
      consumedPackage('committed', [packagedSession({ status: 'completed' })]);
      accountSessions = [{ id: GUEST_SESSION, status: 'completed' }];
      accountSessionById = { [GUEST_SESSION]: { id: GUEST_SESSION, status: 'completed' } };
      accountCompleted = true;

      await expect(drain()).resolves.toMatchObject({ status: 'acknowledged' });

      expect(statements(/pattern_chart_entitlements/)).toHaveLength(1);
    });

    it('copies the Guest unlock to the account before reporting Promotion-Locked', async () => {
      consumedPackage('committed', [packagedSession()]);
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];
      locked = true;

      await expect(drain()).resolves.toMatchObject({ isLocked: true });

      const order = managerQuery.mock.calls.map(([sql]: [string]) => sql);
      expect(order.findIndex((sql: string) => sql.includes('PK_pattern_unlocks'))).toBeLessThan(
        order.findIndex((sql: string) => sql.includes('AS locked')),
      );
    });

    it('continues an active Guest session as a Replay Session next to completed history', async () => {
      consumedPackage('committed', [packagedSession()]);
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];
      accountSessions = [{ id: ACCOUNT_SESSION, status: 'completed' }];

      await expect(drain()).resolves.toEqual({
        status: 'transferred',
        role: 'replay',
        accountSessionId: GUEST_SESSION,
        ...survivingProgress,
      });
      expect(statements(/unnest\(\$3::int\[\]\)/)[0][1][0]).toBe(GUEST_SESSION);
    });

    it('merges two active sessions into the account session and deletes the Guest row', async () => {
      consumedPackage('committed', [packagedSession()]);
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];
      accountSessions = [{ id: ACCOUNT_SESSION, status: 'active' }];

      await expect(drain()).resolves.toEqual({
        status: 'merged',
        accountSessionId: ACCOUNT_SESSION,
        ...survivingProgress,
      });
      expect(statements(/DELETE FROM sessions\.stitching_sessions/)[0][1]).toEqual([GUEST_SESSION]);
      expect(statements(/unnest\(\$3::int\[\]\)/)[0][1][0]).toBe(ACCOUNT_SESSION);
    });

    it('flags the account session as having progress when merged Guest cells move over', async () => {
      consumedPackage('committed', [packagedSession()]);
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];
      accountSessions = [{ id: ACCOUNT_SESSION, status: 'active' }];
      const routed = managerQuery.getMockImplementation();
      managerQuery.mockImplementation(async (sql: string, params: unknown[]) => {
        if (/SELECT cell_index, state, revision FROM sessions\.session_cell_state/.test(sql)) {
          return [{ cell_index: 1, state: 'completed', revision: '2' }];
        }
        return routed ? routed(sql, params) : [];
      });

      await drain();

      const order = managerQuery.mock.calls.map(([sql]: [string]) => sql);
      const remove = order.findIndex((sql: string) => sql.includes('DELETE FROM sessions.stitching_sessions'));
      const flagBeforeDelete = managerQuery.mock.calls.findIndex(
        ([sql, params]: [string, unknown[]]) =>
          sql.includes('session_progress_flags') && (params as string[])[0] === ACCOUNT_SESSION,
      );
      expect(flagBeforeDelete).toBeGreaterThanOrEqual(0);
      expect(flagBeforeDelete).toBeLessThan(remove);
    });

    it('keeps both attempts when both are completed', async () => {
      consumedPackage('committed', [packagedSession({ status: 'completed', completedAt: '2026-11-01T12:00:00.000Z' })]);
      guestSessions = [{ id: GUEST_SESSION, status: 'completed' }];
      accountSessions = [{ id: ACCOUNT_SESSION, status: 'completed' }];

      await expect(drain()).resolves.toMatchObject({ status: 'transferred', accountSessionId: GUEST_SESSION });
      expect(statements(/DELETE FROM sessions\.stitching_sessions/)).toHaveLength(0);
    });

    it('completes a fully stitched packaged session with its own completion time and no reward', async () => {
      consumedPackage('committed', [packagedSession({ status: 'completed', completedAt: '2026-11-01T12:00:00.000Z' })]);
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];
      completedCellCount = 4;

      await drain();

      expect(statements(/SET status = 'completed'/)[0][1]).toEqual([GUEST_SESSION, '2026-11-01T12:00:00.000Z']);
      expect(statements(/SET terminal_completed_at/)).toHaveLength(1);
      expect(statements(/coin_ledger|coin_balances/)).toHaveLength(0);
    });

    it('completes a sparse packaged session at its stitchable count', async () => {
      consumedPackage('committed', [packagedSession({ status: 'completed', completedAt: '2026-11-01T12:00:00.000Z' })]);
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];
      stitchableCellCount = 3;
      completedCellCount = 3;

      await drain();

      expect(statements(/SET status = 'completed'/)).toHaveLength(1);
    });

    it('leaves a partly stitched packaged completion active', async () => {
      consumedPackage('committed', [packagedSession({ status: 'completed', completedAt: '2026-11-01T12:00:00.000Z' })]);
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];
      completedCellCount = 3;

      await drain();

      expect(statements(/SET status = 'completed'/)).toHaveLength(0);
    });

    it('does not mark progress for an empty bitmap', async () => {
      consumedPackage('committed', [packagedSession({ packedBitmapBase64: '' })]);
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];

      await drain();

      expect(statements(/unnest\(\$3::int\[\]\)/)).toHaveLength(0);
      expect(statements(/session_progress_flags/)).toHaveLength(0);
    });

    it('moves the session without writing cells when the package predates sessions', async () => {
      consumedPackage('committed');
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];

      await expect(drain()).resolves.toMatchObject({ status: 'transferred', accountSessionId: GUEST_SESSION });

      expect(statements(/SET principal_type = 'account'/)).toHaveLength(1);
      expect(statements(/pg_advisory_xact_lock|unnest/)).toHaveLength(0);
    });

    it('scopes the Guest session lookup to the Guest and the Pattern', async () => {
      consumedPackage('committed', [packagedSession()]);

      await drain();

      expect(statements(/principal_type = 'guest' AND principal_id = \$2/)[0][1]).toEqual([GUEST_SESSION, GUEST_ID, PATTERN]);
    });

    it('acknowledges a retry of a transferred session by id, writing nothing', async () => {
      consumedPackage('committed', [packagedSession()]);
      accountSessionById[GUEST_SESSION] = { id: GUEST_SESSION, status: 'active' };

      await expect(drain()).resolves.toEqual({
        status: 'acknowledged',
        accountSessionId: GUEST_SESSION,
        ...survivingProgress,
      });
      expect(managerQuery.mock.calls.filter(([sql]: [string]) => WRITES.test(sql))).toHaveLength(0);
    });

    it('acknowledges a retry of a merged session with the account session, writing nothing', async () => {
      consumedPackage('committed', [packagedSession()]);
      accountSessions = [{ id: ACCOUNT_SESSION, status: 'active' }];

      await expect(drain()).resolves.toEqual({
        status: 'acknowledged',
        accountSessionId: ACCOUNT_SESSION,
        ...survivingProgress,
      });
      expect(managerQuery.mock.calls.filter(([sql]: [string]) => WRITES.test(sql))).toHaveLength(0);
    });

    it('reports session_not_found when no reachable session exists', async () => {
      consumedPackage('committed', [packagedSession()]);

      await expect(drain()).resolves.toEqual({
        status: 'acknowledged',
        detail: 'session_not_found',
        accountSessionId: null,
        revision: 0,
        packedBitmapBase64: null,
        terminalCompleted: false,
        isLocked: false,
      });
      expect(managerQuery.mock.calls.filter(([sql]: [string]) => WRITES.test(sql))).toHaveLength(0);
    });

    it('still drains after the package entered needs_attention', async () => {
      consumedPackage('needs_attention', [packagedSession()]);
      guestSessions = [{ id: GUEST_SESSION, status: 'active' }];

      await expect(drain()).resolves.toMatchObject({ status: 'transferred', accountSessionId: GUEST_SESSION });
    });

    it.each(['staged', 'cancelled'] as const)('refuses a %s package', async (status) => {
      packages.rows.push({ guestId: GUEST_ID, accountId: ACCOUNT_ID, status, promotionMode: null });

      await expect(drain()).rejects.toThrow(ForbiddenException);
    });

    it("refuses another account's package", async () => {
      packages.rows.push({ guestId: GUEST_ID, accountId: OTHER_ACCOUNT_ID, status: 'committed', promotionMode: 'economy' });

      await expect(drain()).rejects.toThrow(ForbiddenException);
    });

    it('parks only the package status when the merge fails', async () => {
      const row = consumedPackage('committed', [packagedSession()]);
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      transaction.mockRejectedValueOnce(new Error('merge failed'));

      await expect(drain()).rejects.toMatchObject({
        response: { code: 'promotion_needs_attention' },
      });

      expect(transferPackageRepo.update).toHaveBeenCalledWith({ guestId: GUEST_ID }, { status: 'needs_attention' });
      expect(transferPackageRepo.save).not.toHaveBeenCalled();
      expect(row.status).toBe('committed');
    });
  });

  describe('drainLike', () => {
    it('still drains after the package entered needs_attention', async () => {
      packages.rows.push({ guestId: GUEST_ID, accountId: ACCOUNT_ID, status: 'needs_attention', promotionMode: 'economy' });
      managerFindOne.mockResolvedValueOnce(null);

      await expect(service.drainLike(ACCOUNT_ID, GUEST_ID, 'pattern-uuid')).resolves.toEqual({ status: 'discarded' });
    });

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
