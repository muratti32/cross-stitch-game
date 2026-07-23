import { Injectable, NotFoundException, UnauthorizedException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { createHmac, randomUUID } from 'crypto';

import { AppConfigService } from '../config/app-config.service';
import { GuestInstallationsRepository } from '../auth/guest-installations.repository';
import { AuthHashingService } from '../auth/auth-hashing.service';
import { PromotionLockEntity, PromotionTransferPackageEntity } from './entities';
import { CoinBalanceEntity, CoinLedgerEntryEntity, CoinLedgerReason, PatternUnlockEntity } from '../economy/entities';
import { PromotionPreviewRequestDto } from './dto/promotion-preview.dto';
import { PromotionPackageRequestDto } from './dto/promotion-package.dto';
import { PromotionCommitRequestDto } from './dto/promotion-commit.dto';
import {
  DAILY_TASK_CELLS_TARGET,
  DAILY_TASK_COLOR_ACTIONS_MIN,
  DAILY_TASK_DISTINCT_COLORS_TARGET,
  DAILY_TASK_KEYS,
  DAILY_TASK_COIN,
  DailyTaskKey,
  firstCompletionReward,
} from '../economy/economy.constants';

@Injectable()
export class PromotionService {
  constructor(
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
  ) {}

  async generatePreview(accountId: string, dto: PromotionPreviewRequestDto) {
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
    if (guest.status === 'revoked') {
      throw new ConflictException('Guest installation has already been consumed');
    }

    // 2. Determine if target account has already performed Guest Economy Promotion
    const count = await this.transferPackageRepo.count({
      where: { accountId, status: 'committed' }
    });
    const hasPromotedEconomy = count > 0;
    const promotionMode = hasPromotedEconomy ? 'data-only' : 'economy';

    // 3. Get Guest Coin Balance
    const guestBalanceRow = await this.coinBalanceRepo.findOne({
      where: { principalType: 'guest', principalId: guestId }
    });
    const guestLedgerBalance = guestBalanceRow ? Number(guestBalanceRow.balance) : 0;

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
    const dispositions = {
      coinBalance: promotionMode === 'economy' ? 'transfer' : 'discard',
      pendingRewards: promotionMode === 'economy' ? 'validate' : 'discard',
      progress: 'transfer',
      completions: 'transfer',
      likes: 'transfer',
    };

    // Short-lived preview duration (5 minutes)
    const expiry = new Date(Date.now() + 5 * 60 * 1000);

    // Cryptographic signature
    const signatureData = {
      guestId,
      accountId,
      manifestChecksum,
      promotionMode,
      guestLedgerBalance,
      expiry: expiry.toISOString(),
    };
    const signature = this.signData(signatureData);

    return {
      guestId,
      accountId,
      promotionMode,
      manifestChecksum,
      guestLedgerBalance,
      validatedPendingRewards,
      rejectedPendingRewards,
      dispositions,
      expiry: expiry.toISOString(),
      signature,
    };
  }

  async acquireLock(accountId: string, previewSignature: string, previewData: any) {
    // 1. Verify preview signature
    const isValid = this.verifySignature(previewData, previewSignature);
    if (!isValid) {
      throw new BadRequestException('Invalid preview signature or preview has been modified');
    }

    // 2. Verify preview has not expired
    if (new Date(previewData.expiry) < new Date()) {
      throw new BadRequestException('Preview has expired');
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
    const { guestId, lockToken, manifestChecksum, packageData, checksum } = dto;

    // 1. Verify active lock exists and token matches
    const lock = await this.lockRepo.findOne({ where: { guestId } });
    if (!lock || lock.token !== lockToken || lock.expiry < new Date()) {
      throw new ConflictException('Active promotion commit lock not found or expired');
    }

    // 2. Save/Stage the Promotion Transfer Package in PostgreSQL
    // Delete any existing package for this guest (clean up previous attempts)
    await this.transferPackageRepo.delete({ guestId });

    const pkg = new PromotionTransferPackageEntity();
    pkg.guestId = guestId;
    pkg.accountId = accountId;
    pkg.manifestChecksum = manifestChecksum;
    pkg.packageData = packageData;
    pkg.checksum = checksum;
    pkg.expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours expiry
    pkg.status = 'staged';
    await this.transferPackageRepo.save(pkg);

    return {
      status: 'staged',
      expiry: pkg.expiry.toISOString(),
    };
  }

  async cancelPromotion(accountId: string, guestId: string) {
    // Verify package belongs to this account
    const pkg = await this.transferPackageRepo.findOne({ where: { guestId, accountId } });
    
    // Release the lock
    await this.lockRepo.delete({ guestId });

    if (pkg) {
      pkg.status = 'cancelled';
      await this.transferPackageRepo.save(pkg);
      await this.transferPackageRepo.delete({ guestId });
    }

    return { status: 'cancelled' };
  }

  async commitPromotion(accountId: string, dto: PromotionCommitRequestDto) {
    const { previewData, signature } = dto;

    // 1. Verify preview signature
    const isValid = this.verifySignature(previewData, signature);
    if (!isValid) {
      throw new BadRequestException('Invalid preview signature');
    }
    if (new Date(previewData.expiry) < new Date()) {
      throw new BadRequestException('Preview has expired');
    }
    if (previewData.accountId !== accountId) {
      throw new UnauthorizedException('Account mismatch');
    }

    const guestId = previewData.guestId;

    let retries = 3;
    while (true) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          // 1. Verify lock exists and has not expired
          const lock = await manager.findOne(PromotionLockEntity, {
            where: { guestId }
          });
          if (!lock || lock.expiry < new Date()) {
            throw new ConflictException('Active promotion commit lock not found or expired');
          }

          // 2. Fetch the staged package
          const pkg = await manager.findOne(PromotionTransferPackageEntity, {
            where: { guestId, status: 'staged' }
          });
          if (!pkg) {
            throw new ConflictException('Staged promotion transfer package not found');
          }

          // 3. Verify target account economic promotion eligibility
          const committedCount = await manager.count(PromotionTransferPackageEntity, {
            where: { accountId, status: 'committed' }
          });
          const hasAlreadyPromoted = committedCount > 0;

          if (previewData.promotionMode === 'economy' && hasAlreadyPromoted) {
            throw new ConflictException('Target account has already performed an economy promotion');
          }

          // 4. Resolve economic value
          if (previewData.promotionMode === 'economy' && !hasAlreadyPromoted) {
            // Transfer remaining Guest Coin balance
            const guestBalanceRow = await manager.findOne(CoinBalanceEntity, {
              where: { principalType: 'guest', principalId: guestId }
            });
            const guestBalance = guestBalanceRow ? Number(guestBalanceRow.balance) : 0;

            if (guestBalance > 0 && guestBalanceRow) {
              // Deduct from guest ledger
              await manager.insert(CoinLedgerEntryEntity, {
                principalType: 'guest',
                principalId: guestId,
                amount: String(-guestBalance),
                reason: CoinLedgerReason.GuestPromotion,
                sourceKey: `guest_promotion:close:${guestId}`,
                granted: true,
              });

              guestBalanceRow.balance = '0';
              await manager.save(CoinBalanceEntity, guestBalanceRow);

              // Credit target account ledger
              const accountSourceKey = `guest_promotion:transfer:${guestId}:${accountId}`;
              await manager.insert(CoinLedgerEntryEntity, {
                principalType: 'account',
                principalId: accountId,
                amount: String(guestBalance),
                reason: CoinLedgerReason.GuestPromotion,
                sourceKey: accountSourceKey,
                granted: true,
              });

              // Update account balance
              const accountBalanceRow = await manager.findOne(CoinBalanceEntity, {
                where: { principalType: 'account', principalId: accountId }
              });
              if (accountBalanceRow) {
                accountBalanceRow.balance = String(Number(accountBalanceRow.balance) + guestBalance);
                await manager.save(CoinBalanceEntity, accountBalanceRow);
              } else {
                await manager.insert(CoinBalanceEntity, {
                  principalType: 'account',
                  principalId: accountId,
                  balance: String(guestBalance),
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
                })
                .orIgnore()
                .execute();
            }

            // Grant validated pending coin rewards
            if (previewData.validatedPendingRewards) {
              for (const sourceKey of previewData.validatedPendingRewards) {
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

                if (insertResult.raw && insertResult.raw.length > 0) {
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
          } else {
            // Data-only promotion: close guest ledger
            const guestBalanceRow = await manager.findOne(CoinBalanceEntity, {
              where: { principalType: 'guest', principalId: guestId }
            });
            if (guestBalanceRow && Number(guestBalanceRow.balance) > 0) {
              const guestBalance = Number(guestBalanceRow.balance);
              await manager.insert(CoinLedgerEntryEntity, {
                principalType: 'guest',
                principalId: guestId,
                amount: String(-guestBalance),
                reason: CoinLedgerReason.GuestPromotion,
                sourceKey: `guest_promotion:close:${guestId}`,
                granted: true,
              });
              guestBalanceRow.balance = '0';
              await manager.save(CoinBalanceEntity, guestBalanceRow);
            }
          }

          // Consume guest installation identity
          await manager.query(
            `UPDATE auth.guest_installations
             SET status = 'revoked'
             WHERE id = $1`,
            [guestId]
          );

          // Revoke refresh tokens
          await manager.query(
            `UPDATE auth.refresh_tokens
             SET status = 'revoked'
             WHERE principal_type = 'guest' AND principal_id = $1`,
            [guestId]
          );

          pkg.status = 'committed';
          await manager.save(PromotionTransferPackageEntity, pkg);
          await manager.delete(PromotionLockEntity, { guestId });

          return { status: 'committed' };
        });
      } catch (err: any) {
        if (err.code === '40001' && retries > 0) {
          retries--;
          continue;
        }
        throw err;
      }
    }
  }

  async drainSession(accountId: string, guestId: string, patternId: string, guestSessionId: string) {
    // Verify package ownership
    const pkg = await this.transferPackageRepo.findOne({
      where: { guestId, accountId, status: 'committed' }
    });
    if (!pkg) {
      throw new ForbiddenException('Staged package not found or not committed');
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        // Find guest session
        const guestSession = await manager.query<any[]>(
          `SELECT id, status, completed_at FROM sessions.stitching_sessions WHERE id = $1`,
          [guestSessionId]
        );
        if (guestSession.length === 0) {
          return { status: 'acknowledged', detail: 'session_not_found' };
        }

        const gSession = guestSession[0];

        // Find target account session
        const accountSessions = await manager.query<any[]>(
          `SELECT id, status, completed_at FROM sessions.stitching_sessions 
           WHERE principal_type = 'account' AND principal_id = $1 AND pattern_id = $2`,
          [accountId, patternId]
        );

        if (accountSessions.length === 0) {
          // No target session: Reassign guest session
          await manager.query(
            `UPDATE sessions.stitching_sessions 
             SET principal_type = 'account', principal_id = $1 
             WHERE id = $2`,
            [accountId, guestSessionId]
          );

          // Check if pattern is Official and locked by the account
          const pattern = await manager.query<any[]>(
            `SELECT unlock_price_tier FROM catalog.patterns WHERE id = $1`,
            [patternId]
          );
          let isLocked = false;
          if (pattern.length > 0 && pattern[0].unlock_price_tier !== null) {
            const unlock = await manager.query<any[]>(
              `SELECT 1 FROM economy.pattern_unlocks WHERE principal_type = 'account' AND principal_id = $1 AND pattern_id = $2`,
              [accountId, patternId]
            );
            isLocked = unlock.length === 0;
          }

          return { status: 'transferred', isLocked };
        }

        const aSession = accountSessions[0];

        if (aSession.status === 'completed' && gSession.status === 'active') {
          // completed+active -> Replay Session
          await manager.query(
            `UPDATE sessions.stitching_sessions 
             SET principal_type = 'account', principal_id = $1 
             WHERE id = $2`,
            [accountId, guestSessionId]
          );
          return { status: 'transferred', role: 'replay' };
        } else if (aSession.status === 'active' && gSession.status === 'active') {
          // active+active -> Merge progress
          const maxRevRow = await manager.query<any[]>(
            `SELECT COALESCE(MAX(server_revision), 0) AS max_rev FROM sessions.progress_operations WHERE session_id = $1`,
            [aSession.id]
          );
          const maxRev = Number(maxRevRow[0].max_rev);

          // Update guest operations to account session and adjust server revision
          await manager.query(
            `UPDATE sessions.progress_operations 
             SET session_id = $1, server_revision = server_revision + $2 
             WHERE session_id = $3`,
            [aSession.id, maxRev, guestSessionId]
          );

          // Merge cell states
          const guestCells = await manager.query<any[]>(
            `SELECT cell_index, state, revision FROM sessions.session_cell_state WHERE session_id = $1`,
            [guestSessionId]
          );

          for (const gCell of guestCells) {
            const aCellRow = await manager.query<any[]>(
              `SELECT state, revision FROM sessions.session_cell_state WHERE session_id = $1 AND cell_index = $2`,
              [aSession.id, gCell.cell_index]
            );

            if (aCellRow.length > 0) {
              const aCell = aCellRow[0];
              const nextState = (gCell.state === 'completed' || aCell.state === 'completed') ? 'completed' : 'incomplete';
              const nextRev = Math.max(Number(gCell.revision), Number(aCell.revision));

              await manager.query(
                `UPDATE sessions.session_cell_state 
                 SET state = $1, revision = $2 
                 WHERE session_id = $3 AND cell_index = $4`,
                [nextState, nextRev, aSession.id, gCell.cell_index]
              );
            } else {
              await manager.query(
                `INSERT INTO sessions.session_cell_state (session_id, cell_index, state, revision) 
                 VALUES ($1, $2, $3, $4)`,
                [aSession.id, gCell.cell_index, gCell.state, gCell.revision]
              );
            }
          }

          // Delete the guest session (cascades deletes remaining children)
          await manager.query(
            `DELETE FROM sessions.stitching_sessions WHERE id = $1`,
            [guestSessionId]
          );

          return { status: 'merged' };
        } else {
          // completed+completed or active+completed -> Reassign and keep both in history
          await manager.query(
            `UPDATE sessions.stitching_sessions 
             SET principal_type = 'account', principal_id = $1 
             WHERE id = $2`,
            [accountId, guestSessionId]
          );
          return { status: 'transferred' };
        }
      });
    } catch (err) {
      // Mark package as needing attention on unresolvable error
      pkg.status = 'needs_attention';
      await this.transferPackageRepo.save(pkg);
      throw new ConflictException({
        code: 'promotion_needs_attention',
        message: 'Collision resolution failed. Flagged for manual support review.',
      });
    }
  }

  async drainLike(accountId: string, guestId: string, patternId: string) {
    const pkg = await this.transferPackageRepo.findOne({
      where: { guestId, accountId, status: 'committed' }
    });
    if (!pkg) {
      throw new ForbiddenException('Staged package not found or not committed');
    }

    // Since there is no database table for likes yet (Issue #29 is open),
    // we acknowledge the transfer of the like.
    return { status: 'acknowledged' };
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

  private signData(data: any): string {
    const payload = JSON.stringify(data);
    return createHmac('sha256', this.config.jwtSecret).update(payload).digest('hex');
  }

  private verifySignature(data: any, signature: string): boolean {
    const signatureData = {
      guestId: data.guestId,
      accountId: data.accountId,
      manifestChecksum: data.manifestChecksum,
      promotionMode: data.promotionMode,
      guestLedgerBalance: data.guestLedgerBalance,
      expiry: data.expiry,
    };
    const expected = this.signData(signatureData);
    return expected === signature;
  }
}
