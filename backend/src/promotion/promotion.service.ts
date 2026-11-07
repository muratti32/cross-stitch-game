import { Injectable, Logger, NotFoundException, UnauthorizedException, ConflictException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, FindOptionsWhere, In, IsNull, MoreThan } from 'typeorm';
import { createHmac, randomUUID } from 'crypto';

import { AppConfigService } from '../config/app-config.service';
import { GuestInstallationsRepository } from '../auth/guest-installations.repository';
import { AuthHashingService } from '../auth/auth-hashing.service';
import { GuestInstallationStatus } from '../auth/entities';
import {
  CONSUMED_PACKAGE_STATUSES,
  PromotionLockEntity,
  PromotionMode,
  PromotionPackageStatus,
  PromotionTransferPackageEntity,
} from './entities';
import { AdAttemptEntity, CoinBalanceEntity, CoinLedgerEntryEntity, CoinLedgerReason, PatternUnlockEntity } from '../economy/entities';
import { AccountStateService } from '../deletion/account-state.service';
import { PromotionPreviewDataDto, PromotionPreviewRequestDto } from './dto/promotion-preview.dto';
import { PromotionPackageRequestDto } from './dto/promotion-package.dto';
import { PromotionCommitRequestDto } from './dto/promotion-commit.dto';
import { PatternLikeService } from '../social/pattern-like.service';
import { PatternEntity } from '../catalog/entities/pattern.entity';
import { applyPackagedProgress, readSurvivingSession } from './drained-session';
import { parsePackagedSessions } from './packaged-session';
import {
  DAILY_TASK_CELLS_TARGET,
  DAILY_TASK_COLOR_ACTIONS_MIN,
  DAILY_TASK_DISTINCT_COLORS_TARGET,
  DAILY_TASK_KEYS,
  DAILY_TASK_COIN,
  DailyTaskKey,
  firstCompletionReward,
} from '../economy/economy.constants';

export interface PromotionPreview {
  guestId: string;
  accountId: string;
  promotionMode: PromotionMode;
  manifestChecksum: string;
  guestLedgerBalance: number;
  guestUnlockCount: number;
  pendingAdAttemptCount: number;
  validatedPendingRewards: string[];
  rejectedPendingRewards: Record<string, string>;
  dispositions: {
    coinBalance: 'transfer' | 'discard';
    pendingRewards: 'validate' | 'discard';
    progress: 'transfer';
    completions: 'transfer';
    likes: 'transfer';
  };
  expiry: string;
  signature: string;
  paidCommerce: 'transfer' | 'none';
}

export interface PromotionCommitResult {
  status: 'committed';
  promotionMode: PromotionMode;
  replayed: boolean;
}

export interface DrainSessionResult {
  status: 'transferred' | 'merged' | 'acknowledged';
  accountSessionId: string | null;
  revision: number;
  packedBitmapBase64: string | null;
  terminalCompleted: boolean;
  isLocked: boolean;
  detail?: string;
  role?: 'replay';
}

interface DrainedGuestSession {
  id: string;
  status: 'active' | 'completed';
}

interface CellStateRow {
  cell_index: number;
  state: 'completed' | 'incomplete';
  revision: string;
}

interface PromotionSessionMergeOutcome {
  status: 'transferred' | 'merged';
  sessionId: string;
  role?: 'replay';
}

type SignedPreviewFields = Pick<
  PromotionPreviewDataDto,
  'guestId' | 'accountId' | 'manifestChecksum' | 'promotionMode' | 'guestLedgerBalance' | 'expiry'
>;

const PROMOTION_ERRORS = {
  guest_consumed: { status: HttpStatus.CONFLICT, message: 'Guest installation has already been promoted' },
  promotion_stale: { status: HttpStatus.CONFLICT, message: 'Target account has already used its Guest Economy Promotion' },
  promotion_lock_expired: { status: HttpStatus.CONFLICT, message: 'Active promotion commit lock not found or expired' },
  preview_expired: { status: HttpStatus.BAD_REQUEST, message: 'Preview has expired' },
  preview_invalid: { status: HttpStatus.BAD_REQUEST, message: 'Invalid preview signature or preview has been modified' },
  package_invalid: { status: HttpStatus.BAD_REQUEST, message: 'Promotion Transfer Package has malformed sessions' },
} as const;

export type PromotionErrorCode = keyof typeof PROMOTION_ERRORS;

function promotionError(code: PromotionErrorCode): HttpException {
  const { status, message } = PROMOTION_ERRORS[code];
  return new HttpException({ statusCode: status, code, message }, status);
}

const UNCOMMITTED_PACKAGE_STATUSES: readonly PromotionPackageStatus[] = ['staged', 'cancelled'];

function isConsumedPackage(pkg: PromotionTransferPackageEntity): boolean {
  return CONSUMED_PACKAGE_STATUSES.includes(pkg.status);
}

/** The account's one lifetime economy slot is used once any of its packages is committed. */
function economySlotWhere(accountId: string): FindOptionsWhere<PromotionTransferPackageEntity> {
  return { accountId, status: In([...CONSUMED_PACKAGE_STATUSES]) };
}

const COMMIT_RETRIES = 3;
const COMMIT_RETRY_DELAY_MS = 25;

/** 40001: serialization failure. 55P03: the NOWAIT package lock met an in-flight ad grant. */
function isRetryableCommitError(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
  return code === '40001' || code === '55P03';
}

@Injectable()
export class PromotionService {
  private readonly logger = new Logger(PromotionService.name);

  constructor(
    private readonly patternLikeService: PatternLikeService,
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
    private readonly authHashing: AuthHashingService,
    private readonly guestInstallationsRepo: GuestInstallationsRepository,
    @InjectRepository(PromotionLockEntity)
    private readonly lockRepo: Repository<PromotionLockEntity>,
    @InjectRepository(PromotionTransferPackageEntity)
    private readonly transferPackageRepo: Repository<PromotionTransferPackageEntity>,
    @InjectRepository(CoinBalanceEntity)
    private readonly coinBalanceRepo: Repository<CoinBalanceEntity>,
    @InjectRepository(CoinLedgerEntryEntity)
    private readonly coinLedgerEntryRepo: Repository<CoinLedgerEntryEntity>,
    private readonly accountStateService: AccountStateService,
  ) {}

  async generatePreview(accountId: string, dto: PromotionPreviewRequestDto): Promise<PromotionPreview> {
    const status = await this.accountStateService.getAccountStatus(accountId);
    if (status === 'closing') {
      throw new ForbiddenException('Account is closing');
    }
    const { guestId, guestCredential, manifest, manifestChecksum } = dto;

    // 1. Authenticate guest
    const guest = await this.guestInstallationsRepo.findOneById(guestId);
    if (!guest) {
      throw new NotFoundException('Guest installation not found');
    }
    const isCredValid = await this.authHashing.verifyCredentialSecret(guestCredential, guest.credentialHash);
    if (!isCredValid) {
      throw new UnauthorizedException('Invalid guest credentials');
    }
    if (guest.status === GuestInstallationStatus.Revoked) {
      throw promotionError('guest_consumed');
    }
    // Commit leaves the Guest unrevoked while paid commerce is still handing
    // off, so the committed package is the authoritative consumption record.
    const guestPackage = await this.transferPackageRepo.findOne({ where: { guestId } });
    if (guestPackage && isConsumedPackage(guestPackage)) {
      throw promotionError('guest_consumed');
    }

    // 2. Determine if target account has already used its Guest Economy Promotion
    const slotUsed = (await this.transferPackageRepo.count({ where: economySlotWhere(accountId) })) > 0;
    const promotionMode: PromotionMode = slotUsed ? 'data-only' : 'economy';

    // 3. Get Guest Coin Balance, Pattern Unlocks and still-verifiable rewarded ads
    const guestBalanceRow = await this.coinBalanceRepo.findOne({
      where: { principalType: 'guest', principalId: guestId }
    });
    const guestLedgerBalance = guestBalanceRow ? Number(guestBalanceRow.balance) : 0;
    const guestUnlockCount = await this.dataSource.manager.count(PatternUnlockEntity, {
      where: { principalType: 'guest', principalId: guestId },
    });
    const pendingAdAttemptCount = await this.dataSource.manager.count(AdAttemptEntity, {
      where: { principalType: 'guest', principalId: guestId, consumedAt: IsNull(), expiresAt: MoreThan(new Date()) },
    });

    // 4. Validate Pending Coin Rewards
    const validatedPendingRewards: string[] = [];
    const rejectedPendingRewards: Record<string, string> = {};

    if (manifest.pendingRewards && promotionMode === 'economy') {
      for (const sourceKey of Object.keys(manifest.pendingRewards)) {
        const validation = await this.validatePendingReward(this.dataSource.manager, guestId, sourceKey);
        if (validation.valid) {
          validatedPendingRewards.push(sourceKey);
        } else {
          rejectedPendingRewards[sourceKey] = validation.reason || 'invalid_evidence';
        }
      }
    } else if (manifest.pendingRewards && promotionMode === 'data-only') {
      for (const sourceKey of Object.keys(manifest.pendingRewards)) {
        rejectedPendingRewards[sourceKey] = 'promotion_mode_data_only';
      }
    }

    // 5. Preview dispositions itemization
    const dispositions: PromotionPreview['dispositions'] = {
      coinBalance: promotionMode === 'economy' ? 'transfer' : 'discard',
      pendingRewards: promotionMode === 'economy' ? 'validate' : 'discard',
      progress: 'transfer',
      completions: 'transfer',
      likes: 'transfer',
    };

    // Short-lived preview duration (5 minutes)
    const expiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const signature = this.signPreview({
      guestId,
      accountId,
      manifestChecksum,
      promotionMode,
      guestLedgerBalance,
      expiry,
    });

    return {
      guestId,
      accountId,
      promotionMode,
      manifestChecksum,
      guestLedgerBalance,
      guestUnlockCount,
      pendingAdAttemptCount,
      validatedPendingRewards,
      rejectedPendingRewards,
      dispositions,
      expiry,
      signature,
      paidCommerce: guestBalanceRow?.paidBalance !== undefined && Number(guestBalanceRow.paidBalance) > 0 ? 'transfer' : 'none',
    };
  }

  async acquireLock(accountId: string, previewSignature: string, previewData: PromotionPreviewDataDto) {
    const status = await this.accountStateService.getAccountStatus(accountId);
    if (status === 'closing') {
      throw new ForbiddenException('Account is closing');
    }
    // 1. Verify preview signature
    if (!this.verifySignature(previewData, previewSignature)) {
      throw promotionError('preview_invalid');
    }

    // 2. Verify preview has not expired
    if (new Date(previewData.expiry) < new Date()) {
      throw promotionError('preview_expired');
    }

    // 3. Verify target account matches authenticated user
    if (previewData.accountId !== accountId) {
      throw new UnauthorizedException('Account mismatch');
    }

    const guestId = previewData.guestId;

    // 4. Acquire single short-lived lock (Promotion Commit Lock)
    // Delete any expired lock for this guest first
    await this.lockRepo.delete({ guestId });

    const lock = new PromotionLockEntity();
    lock.guestId = guestId;
    lock.token = randomUUID();
    lock.expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes lock lease
    await this.lockRepo.save(lock);

    return {
      lockToken: lock.token,
      expiry: lock.expiry.toISOString(),
    };
  }

  async stagePackage(accountId: string, dto: PromotionPackageRequestDto) {
    const status = await this.accountStateService.getAccountStatus(accountId);
    if (status === 'closing') {
      throw new ForbiddenException('Account is closing');
    }
    const { guestId, lockToken, manifestChecksum, packageData, checksum } = dto;

    if (parsePackagedSessions(packageData) === null) {
      throw promotionError('package_invalid');
    }

    // 1. A committed package is the durable post-commit record; never replace it.
    const existing = await this.transferPackageRepo.findOne({ where: { guestId } });
    if (existing && isConsumedPackage(existing)) {
      throw promotionError('guest_consumed');
    }

    // 2. Verify active lock exists and token matches
    const lock = await this.lockRepo.findOne({ where: { guestId } });
    if (!lock || lock.token !== lockToken || lock.expiry < new Date()) {
      throw promotionError('promotion_lock_expired');
    }

    // 3. Replace any earlier uncommitted attempt. insert (not save) so a package
    //    committed concurrently fails on the primary key instead of being overwritten.
    await this.transferPackageRepo.delete({ guestId, status: In(UNCOMMITTED_PACKAGE_STATUSES) });

    const pkg = new PromotionTransferPackageEntity();
    pkg.guestId = guestId;
    pkg.accountId = accountId;
    pkg.manifestChecksum = manifestChecksum;
    pkg.packageData = packageData;
    pkg.checksum = checksum;
    pkg.expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours expiry
    pkg.status = 'staged';
    pkg.promotionMode = null;
    await this.transferPackageRepo.insert(pkg);

    return {
      status: 'staged',
      expiry: pkg.expiry.toISOString(),
    };
  }

  async cancelPromotion(accountId: string, guestId: string) {
    await this.lockRepo.delete({ guestId });
    await this.transferPackageRepo.delete({ guestId, accountId, status: In(UNCOMMITTED_PACKAGE_STATUSES) });
    return { status: 'cancelled' };
  }

  async commitPromotion(accountId: string, dto: PromotionCommitRequestDto): Promise<PromotionCommitResult> {
    const status = await this.accountStateService.getAccountStatus(accountId);
    if (status === 'closing') {
      throw new ForbiddenException('Account is closing');
    }
    const { previewData, signature } = dto;

    if (!this.verifySignature(previewData, signature)) {
      throw promotionError('preview_invalid');
    }
    if (previewData.accountId !== accountId) {
      throw new UnauthorizedException('Account mismatch');
    }

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', (manager) =>
          this.commitInTransaction(manager, accountId, previewData),
        );
      } catch (err: unknown) {
        if (attempt > COMMIT_RETRIES || !isRetryableCommitError(err)) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, COMMIT_RETRY_DELAY_MS * attempt));
      }
    }
  }

  private async commitInTransaction(
    manager: EntityManager,
    accountId: string,
    previewData: PromotionPreviewDataDto,
  ): Promise<PromotionCommitResult> {
    const { guestId } = previewData;

    // Must be this transaction's first statement, and NOWAIT rather than a
    // blocking lock: an in-flight ad grant holds this row FOR SHARE
    // (CoinLedgerRepository.grantAdReward). Waiting for it would keep this
    // SERIALIZABLE snapshot from seeing the coin that grant credits to the
    // Guest Ledger, so fail fast and retry with a fresh snapshot instead.
    const pkg = await manager.findOne(PromotionTransferPackageEntity, {
      where: { guestId },
      lock: { mode: 'pessimistic_write', onLocked: 'nowait' },
    });

    if (pkg && isConsumedPackage(pkg)) {
      if (pkg.accountId !== accountId) {
        throw promotionError('guest_consumed');
      }
      return { status: 'committed', promotionMode: pkg.promotionMode ?? previewData.promotionMode, replayed: true };
    }

    if (new Date(previewData.expiry) < new Date()) {
      throw promotionError('preview_expired');
    }

    const lock = await manager.findOne(PromotionLockEntity, { where: { guestId } });
    if (!lock || lock.expiry < new Date()) {
      throw promotionError('promotion_lock_expired');
    }

    if (!pkg || pkg.status !== 'staged') {
      throw new ConflictException('Staged promotion transfer package not found');
    }

    const slotUsed = (await manager.count(PromotionTransferPackageEntity, { where: economySlotWhere(accountId) })) > 0;
    const promotionMode = previewData.promotionMode;
    if (promotionMode === 'economy' && slotUsed) {
      throw promotionError('promotion_stale');
    }

    if (promotionMode === 'economy') {
      await this.transferGuestEconomy(manager, guestId, accountId, previewData.validatedPendingRewards ?? []);
    } else {
      await this.discardGuestEconomy(manager, guestId);
    }

    const mayRevokeGuest = await this.mayRevokeGuest(manager, guestId, accountId);

    // Consume guest installation identity only after paid commerce is acknowledged.
    if (mayRevokeGuest) await manager.query(
      `UPDATE auth.guest_installations
       SET status = 'revoked'
       WHERE id = $1`,
      [guestId]
    );

    // Revoke refresh tokens when the Guest Installation Identity is safe to close.
    if (mayRevokeGuest) await manager.query(
      `UPDATE auth.refresh_tokens
       SET status = 'revoked'
       WHERE principal_type = 'guest' AND principal_id = $1`,
      [guestId]
    );

    pkg.status = 'committed';
    pkg.promotionMode = promotionMode;
    await manager.save(PromotionTransferPackageEntity, pkg);
    await manager.delete(PromotionLockEntity, { guestId });

    return { status: 'committed', promotionMode, replayed: false };
  }

  /** Lifetime Guest Economy Promotion: move free Coin, union Unlocks, grant validated pending rewards. */
  private async transferGuestEconomy(
    manager: EntityManager,
    guestId: string,
    accountId: string,
    validatedPendingRewards: readonly string[],
  ): Promise<void> {
    // Transfer remaining Guest Coin balance
    const guestBalanceRow = await manager.findOne(CoinBalanceEntity, {
      where: { principalType: 'guest', principalId: guestId }
    });
    const guestBalance = guestBalanceRow ? Number(guestBalanceRow.balance) : 0;
    const guestPaidReserve = guestBalanceRow ? Number(guestBalanceRow.paidBalance ?? 0) : 0;
    const freeGuestBalance = Math.max(0, guestBalance - guestPaidReserve);

    if (freeGuestBalance > 0 && guestBalanceRow) {
      // Deduct from guest ledger
      await manager.insert(CoinLedgerEntryEntity, {
        principalType: 'guest',
        principalId: guestId,
        amount: String(-freeGuestBalance),
        reason: CoinLedgerReason.GuestPromotion,
        sourceKey: `guest_promotion:close:${guestId}`,
        granted: true,
      });

      guestBalanceRow.balance = String(guestBalance - freeGuestBalance);
      await manager.save(CoinBalanceEntity, guestBalanceRow);

      // Credit target account ledger
      const accountSourceKey = `guest_promotion:transfer:${guestId}:${accountId}`;
      await manager.insert(CoinLedgerEntryEntity, {
        principalType: 'account',
        principalId: accountId,
        amount: String(freeGuestBalance),
        reason: CoinLedgerReason.GuestPromotion,
        sourceKey: accountSourceKey,
        granted: true,
      });

      // Update account balance
      const accountBalanceRow = await manager.findOne(CoinBalanceEntity, {
        where: { principalType: 'account', principalId: accountId }
      });
      if (accountBalanceRow) {
        accountBalanceRow.balance = String(Number(accountBalanceRow.balance) + freeGuestBalance);
        await manager.save(CoinBalanceEntity, accountBalanceRow);
      } else {
        await manager.insert(CoinBalanceEntity, {
          principalType: 'account',
          principalId: accountId,
          balance: String(freeGuestBalance),
        });
      }
    }

    // Union Pattern Unlocks
    const guestUnlocks = await manager.find(PatternUnlockEntity, {
      where: { principalType: 'guest', principalId: guestId }
    });
    for (const unlock of guestUnlocks) {
      await manager.createQueryBuilder()
        .insert()
        .into(PatternUnlockEntity)
        .values({
          principalType: 'account',
          principalId: accountId,
          patternId: unlock.patternId,
          source: unlock.source,
        })
        .orIgnore()
        .execute();
    }

    // Grant validated pending coin rewards
    for (const sourceKey of validatedPendingRewards) {
      const validation = await this.validatePendingReward(manager, guestId, sourceKey);
      if (!validation.valid) {
        continue;
      }

      const amount = validation.amount!;
      const reason = validation.ledgerReason!;

      const insertResult = await manager.createQueryBuilder()
        .insert()
        .into(CoinLedgerEntryEntity)
        .values({
          principalType: 'account',
          principalId: accountId,
          amount: String(amount),
          reason,
          sourceKey,
          granted: true,
        })
        .orIgnore()
        .execute();

      const insertedRows: unknown = insertResult.raw;
      if (Array.isArray(insertedRows) && insertedRows.length > 0) {
        // Upsert: an account with no prior grant has no coin_balances
        // row yet, so a bare UPDATE would silently match zero rows
        // and never surface the coin this ledger entry just minted.
        await manager.query(
          `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
           VALUES ('account', $1, $2)
           ON CONFLICT ON CONSTRAINT "PK_coin_balances"
             DO UPDATE SET balance = economy.coin_balances.balance + EXCLUDED.balance,
                           updated_at = now()`,
          [accountId, String(amount)]
        );
      }
    }
  }

  /** Guest Data-Only Promotion: close the Guest Ledger and discard rewarded ads still verifying. */
  private async discardGuestEconomy(manager: EntityManager, guestId: string): Promise<void> {
    const guestBalanceRow = await manager.findOne(CoinBalanceEntity, {
      where: { principalType: 'guest', principalId: guestId }
    });
    if (guestBalanceRow && Number(guestBalanceRow.balance) - Number(guestBalanceRow.paidBalance ?? 0) > 0) {
      const guestBalance = Number(guestBalanceRow.balance);
      const guestPaidReserve = Number(guestBalanceRow.paidBalance ?? 0);
      const freeGuestBalance = Math.max(0, guestBalance - guestPaidReserve);
      await manager.insert(CoinLedgerEntryEntity, {
        principalType: 'guest',
        principalId: guestId,
        amount: String(-freeGuestBalance),
        reason: CoinLedgerReason.GuestPromotion,
        sourceKey: `guest_promotion:close:${guestId}`,
        granted: true,
      });
      guestBalanceRow.balance = String(guestPaidReserve);
      await manager.save(CoinBalanceEntity, guestBalanceRow);
    }

    await manager.query(
      `UPDATE economy.ad_attempts
       SET expires_at = now()
       WHERE principal_type = 'guest' AND principal_id = $1
         AND consumed_at IS NULL AND expires_at > now()`,
      [guestId],
    );
  }

  /** Guest revocation is safe only after every commerce-owned source is empty or acknowledged. */
  private async mayRevokeGuest(manager: EntityManager, guestId: string, accountId: string): Promise<boolean> {
    const rows = await manager.query<readonly { safe: boolean }[]>(`
      SELECT NOT EXISTS (
        SELECT 1 FROM economy.coin_balances WHERE principal_type='guest' AND principal_id=$1 AND paid_balance > 0
        UNION ALL SELECT 1 FROM economy.ai_credit_balances WHERE principal_type='guest' AND principal_id=$1 AND paid_balance > 0
        UNION ALL SELECT 1 FROM economy.membership_periods WHERE guest_installation_id=$1
        UNION ALL SELECT 1 FROM ai.ai_artworks WHERE guest_installation_id=$1
        UNION ALL SELECT 1 FROM conversion.personal_patterns WHERE guest_installation_id=$1
        UNION ALL SELECT 1 FROM economy.commerce_transaction_bindings WHERE guest_installation_id=$1
      ) OR EXISTS (
        SELECT 1 FROM promotion.commerce_promotion_handoffs
        WHERE guest_id=$1 AND account_id=$2 AND state='acknowledged'
      ) AS safe`, [guestId, accountId]);
    return rows[0]?.safe === true;
  }

  async drainSession(
    accountId: string,
    guestId: string,
    patternId: string,
    guestSessionId: string,
  ): Promise<DrainSessionResult> {
    const pkg = await this.requireConsumedPackage(accountId, guestId);
    const packaged = parsePackagedSessions(pkg.packageData)?.find((session) => session.key === guestSessionId);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const guestSessions = await manager.query<readonly DrainedGuestSession[]>(
          `SELECT id, status FROM sessions.stitching_sessions
           WHERE id = $1 AND principal_type = 'guest' AND principal_id = $2 AND pattern_id = $3
           FOR UPDATE`,
          [guestSessionId, guestId, patternId]
        );
        const guestSession = guestSessions[0];
        if (!guestSession) {
          return this.acknowledgeDrainedSession(manager, accountId, patternId, guestSessionId);
        }

        const patterns = await manager.query<readonly { width: number; height: number }[]>(
          `SELECT width, height FROM catalog.patterns WHERE id = $1 FOR SHARE`,
          [patternId]
        );

        await manager.query(
          `INSERT INTO economy.pattern_unlocks
             (principal_type, principal_id, pattern_id, source)
           SELECT 'account', $1, pattern_id, source
           FROM economy.pattern_unlocks
           WHERE principal_type = 'guest'
             AND principal_id = $2
             AND pattern_id = $3
           ON CONFLICT ON CONSTRAINT "PK_pattern_unlocks" DO NOTHING`,
          [accountId, guestId, patternId]
        );

        const merge = await this.mergeGuestSession(manager, accountId, patternId, guestSession);
        if (packaged) {
          await applyPackagedProgress(manager, {
            sessionId: merge.sessionId,
            guestId,
            packaged,
            totalCells: patterns[0].width * patterns[0].height,
          });
        }

        return {
          status: merge.status,
          role: merge.role,
          accountSessionId: merge.sessionId,
          isLocked: await this.isPromotionLocked(manager, accountId, patternId),
          ...(await readSurvivingSession(manager, merge.sessionId)),
        };
      });
    } catch (err: unknown) {
      this.logger.error(`Session drain failed for Guest ${guestId}`, err instanceof Error ? err.stack : String(err));
      await this.transferPackageRepo.update({ guestId }, { status: 'needs_attention' });
      throw new ConflictException({
        code: 'promotion_needs_attention',
        message: 'Collision resolution failed. Flagged for manual support review.',
      });
    }
  }

  /**
   * A retry after a lost response finds no Guest row: the session already moved
   * to the account, or merged into its active session and was deleted. Reports
   * that state without writing, so progress the player changed since stays.
   */
  private async acknowledgeDrainedSession(
    manager: EntityManager,
    accountId: string,
    patternId: string,
    guestSessionId: string,
  ): Promise<DrainSessionResult> {
    const survivors = await manager.query<readonly { id: string }[]>(
      `SELECT id FROM sessions.stitching_sessions
       WHERE principal_type = 'account' AND principal_id = $1 AND (id = $2 OR pattern_id = $3)
       ORDER BY id = $2 DESC, status = 'active' DESC, created_at DESC
       LIMIT 1`,
      [accountId, guestSessionId, patternId]
    );
    const survivor = survivors[0];
    if (!survivor) {
      return {
        status: 'acknowledged',
        detail: 'session_not_found',
        accountSessionId: null,
        revision: 0,
        packedBitmapBase64: null,
        terminalCompleted: false,
        isLocked: false,
      };
    }
    return {
      status: 'acknowledged',
      accountSessionId: survivor.id,
      isLocked: await this.isPromotionLocked(manager, accountId, patternId),
      ...(await readSurvivingSession(manager, survivor.id)),
    };
  }

  /** Promotion Session Merge by Pattern (ADR-0026); returns the session that survives. */
  private async mergeGuestSession(
    manager: EntityManager,
    accountId: string,
    patternId: string,
    guestSession: DrainedGuestSession,
  ): Promise<PromotionSessionMergeOutcome> {
    const guestSessionId = guestSession.id;
    // Active first: reassigning an active Guest session next to an active
    // account session would break the one-active-per-Pattern index.
    const accountSessions = await manager.query<readonly DrainedGuestSession[]>(
      `SELECT id, status FROM sessions.stitching_sessions
       WHERE principal_type = 'account' AND principal_id = $1 AND pattern_id = $2
       ORDER BY status = 'active' DESC, created_at DESC
       FOR UPDATE`,
      [accountId, patternId]
    );
    const accountSession = accountSessions[0];

    if (accountSession?.status === 'active' && guestSession.status === 'active') {
      await this.mergeActiveSessions(manager, accountSession.id, guestSessionId);
      return { status: 'merged', sessionId: accountSession.id };
    }

    await manager.query(
      `UPDATE sessions.stitching_sessions
       SET principal_type = 'account', principal_id = $1
       WHERE id = $2`,
      [accountId, guestSessionId]
    );
    if (accountSession?.status === 'completed' && guestSession.status === 'active') {
      return { status: 'transferred', sessionId: guestSessionId, role: 'replay' };
    }
    return { status: 'transferred', sessionId: guestSessionId };
  }

  private async mergeActiveSessions(
    manager: EntityManager,
    accountSessionId: string,
    guestSessionId: string,
  ): Promise<void> {
    const maxRevRow = await manager.query<readonly { max_rev: string }[]>(
      `SELECT COALESCE(MAX(server_revision), 0) AS max_rev FROM sessions.progress_operations WHERE session_id = $1`,
      [accountSessionId]
    );
    const maxRev = Number(maxRevRow[0].max_rev);

    // Update guest operations to account session and adjust server revision
    await manager.query(
      `UPDATE sessions.progress_operations
       SET session_id = $1, server_revision = server_revision + $2
       WHERE session_id = $3`,
      [accountSessionId, maxRev, guestSessionId]
    );

    // Merge cell states
    const guestCells = await manager.query<readonly CellStateRow[]>(
      `SELECT cell_index, state, revision FROM sessions.session_cell_state WHERE session_id = $1`,
      [guestSessionId]
    );

    for (const gCell of guestCells) {
      const aCellRow = await manager.query<readonly Omit<CellStateRow, 'cell_index'>[]>(
        `SELECT state, revision FROM sessions.session_cell_state WHERE session_id = $1 AND cell_index = $2`,
        [accountSessionId, gCell.cell_index]
      );

      if (aCellRow.length > 0) {
        const aCell = aCellRow[0];
        const nextState = (gCell.state === 'completed' || aCell.state === 'completed') ? 'completed' : 'incomplete';
        const nextRev = Math.max(Number(gCell.revision), Number(aCell.revision));

        await manager.query(
          `UPDATE sessions.session_cell_state
           SET state = $1, revision = $2
           WHERE session_id = $3 AND cell_index = $4`,
          [nextState, nextRev, accountSessionId, gCell.cell_index]
        );
      } else {
        await manager.query(
          `INSERT INTO sessions.session_cell_state (session_id, cell_index, state, revision)
           VALUES ($1, $2, $3, $4)`,
          [accountSessionId, gCell.cell_index, gCell.state, gCell.revision]
        );
      }
    }

    // Delete the guest session (cascades deletes remaining children)
    await manager.query(
      `DELETE FROM sessions.stitching_sessions WHERE id = $1`,
      [guestSessionId]
    );
  }

  /** A paid Official Pattern the account never unlocked: its progress stays, its artifact does not. */
  private async isPromotionLocked(manager: EntityManager, accountId: string, patternId: string): Promise<boolean> {
    const rows = await manager.query<readonly { locked: boolean }[]>(
      `SELECT pattern.unlock_price_tier IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM economy.pattern_unlocks unlock
         WHERE unlock.principal_type = 'account' AND unlock.principal_id = $1 AND unlock.pattern_id = pattern.id
       ) AS locked
       FROM catalog.patterns pattern
       WHERE pattern.id = $2`,
      [accountId, patternId]
    );
    return rows[0]?.locked === true;
  }

  /** Drain keeps working after a failure parked the package in needs_attention. */
  private async requireConsumedPackage(accountId: string, guestId: string): Promise<PromotionTransferPackageEntity> {
    const pkg = await this.transferPackageRepo.findOne({
      where: { ...economySlotWhere(accountId), guestId },
    });
    if (!pkg) {
      throw new ForbiddenException('Staged package not found or not committed');
    }
    return pkg;
  }

  async drainLike(
    accountId: string,
    guestId: string,
    patternId: string,
  ): Promise<{ status: 'applied' | 'already_present' | 'discarded' }> {
    await this.requireConsumedPackage(accountId, guestId);

    return await this.dataSource.transaction(async (manager) => {
      const pattern = await manager.findOne(PatternEntity, {
        where: { id: patternId },
      });
      if (!pattern || pattern.visibility === 'personal' || pattern.status !== 'available') {
        return { status: 'discarded' };
      }

      const result = await this.patternLikeService.likeWithManager(manager, accountId, patternId);
      if (result.wasInserted) {
        return { status: 'applied' };
      } else {
        return { status: 'already_present' };
      }
    });
  }

  async assertNotLocked(principalId: string, principalType: string): Promise<void> {
    if (principalType !== 'guest') return;
    const activeLock = await this.lockRepo.findOne({
      where: { guestId: principalId }
    });
    if (activeLock && activeLock.expiry > new Date()) {
      throw new ConflictException('Guest ledger is locked due to promotion in progress');
    }
  }

  private async validatePendingReward(
    manager: EntityManager,
    guestId: string,
    sourceKey: string,
  ): Promise<{ valid: boolean; reason?: string; amount?: number; ledgerReason?: CoinLedgerReason }> {
    // 1. Check if this sourceKey already exists in the coin ledger
    const existing = await manager.findOne(CoinLedgerEntryEntity, {
      where: { sourceKey }
    });
    if (existing) {
      return { valid: false, reason: 'already_granted' };
    }

    if (sourceKey.startsWith('daily_task:')) {
      const parts = sourceKey.split(':');
      if (parts.length !== 5) {
        return { valid: false, reason: 'invalid_format' };
      }
      const [prefix, type, id, rewardDay, taskKey] = parts;
      if (type !== 'guest' || id !== guestId) {
        return { valid: false, reason: 'ownership_mismatch' };
      }
      if (!DAILY_TASK_KEYS.includes(taskKey as DailyTaskKey)) {
        return { valid: false, reason: 'invalid_format' };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rewardDay)) {
        return { valid: false, reason: 'invalid_format' };
      }
      if (new Date(rewardDay) > new Date()) {
        return { valid: false, reason: 'implausible_evidence' };
      }

      // Check Guest progress in database
      const colorCounts = await manager.query<{ action_count: number }[]>(
        `SELECT action_count
         FROM economy.daily_color_action_counts
         WHERE principal_type = 'guest'
           AND principal_id = $1
           AND reward_day = $2`,
        [guestId, rewardDay],
      );

      let totalActions = 0;
      let distinctColorsAtThreshold = 0;
      for (const row of colorCounts) {
        const count = Number(row.action_count);
        totalActions += count;
        if (count >= DAILY_TASK_COLOR_ACTIONS_MIN) {
          distinctColorsAtThreshold += 1;
        }
      }

      const completionRows = await manager.query<{ exists: boolean }[]>(
        `SELECT EXISTS(
           SELECT 1
           FROM economy.gameplay_events
           WHERE principal_type = 'guest'
             AND principal_id = $1
             AND reward_day = $2
             AND kind = 'color_completion'
         ) AS "exists"`,
        [guestId, rewardDay],
      );
      const hasColorCompletion = completionRows[0]?.exists ?? false;

      let isCompleted = false;
      if (taskKey === 'cells_100') {
        isCompleted = totalActions >= DAILY_TASK_CELLS_TARGET;
      } else if (taskKey === 'three_colors_10') {
        isCompleted = distinctColorsAtThreshold >= DAILY_TASK_DISTINCT_COLORS_TARGET;
      } else if (taskKey === 'color_completion') {
        isCompleted = hasColorCompletion;
      }

      if (!isCompleted) {
        return { valid: false, reason: 'implausible_evidence' };
      }

      return {
        valid: true,
        amount: DAILY_TASK_COIN,
        ledgerReason: CoinLedgerReason.DailyTask,
      };
    }

    if (sourceKey.startsWith('first_completion:')) {
      const parts = sourceKey.split(':');
      if (parts.length !== 4) {
        return { valid: false, reason: 'invalid_format' };
      }
      const [prefix, type, id, patternId] = parts;
      if (type !== 'guest' || id !== guestId) {
        return { valid: false, reason: 'ownership_mismatch' };
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patternId)) {
        return { valid: false, reason: 'invalid_format' };
      }

      // Query pattern to confirm eligibility. Personal Patterns never mint
      // First Completion (ADR-0011) — only catalog Patterns qualify, matching
      // the online grant path's `visibility === 'catalog'` check.
      const patterns = await manager.query<{ width: number; height: number; visibility: string }[]>(
        `SELECT width, height, visibility FROM catalog.patterns WHERE id = $1`,
        [patternId]
      );
      if (patterns.length === 0 || patterns[0].visibility !== 'catalog') {
        return { valid: false, reason: 'pattern_ineligible' };
      }

      // Query guest session to confirm completion
      const completedSessions = await manager.query<{ exists: boolean }[]>(
        `SELECT EXISTS(
           SELECT 1 FROM sessions.stitching_sessions
           WHERE principal_type = 'guest'
             AND principal_id = $1
             AND pattern_id = $2
             AND status = 'completed'
         ) AS "exists"`,
        [guestId, patternId]
      );
      if (!(completedSessions[0]?.exists ?? false)) {
        return { valid: false, reason: 'implausible_evidence' };
      }

      const cells = patterns[0].width * patterns[0].height;
      const amount = firstCompletionReward(cells);

      return {
        valid: true,
        amount,
        ledgerReason: CoinLedgerReason.FirstCompletion,
      };
    }

    return { valid: false, reason: 'invalid_format' };
  }

  private signPreview(fields: SignedPreviewFields): string {
    // Fixed key order: the HMAC covers this exact JSON serialization.
    const payload = JSON.stringify({
      guestId: fields.guestId,
      accountId: fields.accountId,
      manifestChecksum: fields.manifestChecksum,
      promotionMode: fields.promotionMode,
      guestLedgerBalance: fields.guestLedgerBalance,
      expiry: fields.expiry,
    });
    return createHmac('sha256', this.config.jwtSecret).update(payload).digest('hex');
  }

  private verifySignature(previewData: PromotionPreviewDataDto, signature: string): boolean {
    return this.signPreview(previewData) === signature;
  }
}
