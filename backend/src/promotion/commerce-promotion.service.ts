import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuthHashingService } from '../auth/auth-hashing.service';
import { GuestInstallationsRepository } from '../auth/guest-installations.repository';
import { GuestInstallationStatus } from '../auth/entities/guest-installation-status.enum';
import { CommercePromotionHandoffEntity } from './entities';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository';
import { COMMERCE_PROMOTION_JOB_EVENT_NAME, COMMERCE_PROMOTION_JOB_TYPE } from '../jobs/jobs.constants';

export interface CommercePromotionStatus {
  handoffId: string;
  status: 'pending' | 'processing' | 'acknowledged' | 'failed';
  syncingPurchases: boolean;
  attemptCount: number;
  lastFailureReason: string | null;
}

@Injectable()
export class CommercePromotionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hashing: AuthHashingService,
    private readonly guests: GuestInstallationsRepository,
    @InjectRepository(CommercePromotionHandoffEntity)
    private readonly handoffs: Repository<CommercePromotionHandoffEntity>,
    private readonly processingJobs: ProcessingJobsRepository,
  ) {}

  async start(accountId: string, guestId: string, credential: string): Promise<CommercePromotionStatus> {
    const guest = await this.guests.findOneById(guestId);
    if (!guest) throw new NotFoundException('Guest installation not found');
    if (!(await this.hashing.verifyCredentialSecret(credential, guest.credentialHash))) {
      throw new UnauthorizedException('Invalid guest credentials');
    }
    if (guest.status === GuestInstallationStatus.Revoked) throw new ConflictException('Guest installation has already been consumed');
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<readonly { id: string }[]>(
        `INSERT INTO promotion.commerce_promotion_handoffs (guest_id, account_id)
         VALUES ($1, $2)
         ON CONFLICT ON CONSTRAINT "UQ_commerce_promotion_handoffs_guest_account"
         DO UPDATE SET updated_at=now()
         RETURNING id`, [guestId, accountId]);
      const handoff = await manager.findOneOrFail(CommercePromotionHandoffEntity, { where: { id: rows[0].id }, lock: { mode: 'pessimistic_write' } });
      if (handoff.processingJobId === null) {
        const job = await this.processingJobs.createPendingWithOutboxFor(manager, {
          eventName: COMMERCE_PROMOTION_JOB_EVENT_NAME,
          type: COMMERCE_PROMOTION_JOB_TYPE,
          payload: { handoffId: handoff.id },
        });
        handoff.processingJobId = job.job.id;
        await manager.save(handoff);
      }
      return this.view(handoff);
    });
  }

  async status(accountId: string, handoffId: string): Promise<CommercePromotionStatus> {
    const handoff = await this.handoffs.findOne({ where: { id: handoffId, accountId } });
    if (!handoff) throw new NotFoundException('Commerce promotion handoff not found');
    return this.view(handoff);
  }

  async retry(accountId: string, handoffId: string): Promise<CommercePromotionStatus> {
    const handoff = await this.handoffs.findOne({ where: { id: handoffId, accountId } });
    if (!handoff) throw new NotFoundException('Commerce promotion handoff not found');
    return this.process(handoff.id);
  }

  async processQueued(handoffId: string): Promise<void> {
    await this.process(handoffId);
  }

  private async process(id: string): Promise<CommercePromotionStatus> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.processOnce(id);
      } catch (error: unknown) {
        if ((error as { code?: string }).code !== '40001' || attempt >= 2) throw error;
      }
    }
  }

  private async processOnce(id: string): Promise<CommercePromotionStatus> {
    try {
      return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        const handoff = await manager.findOne(CommercePromotionHandoffEntity, { where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!handoff) throw new NotFoundException('Commerce promotion handoff not found');
        if (handoff.state === 'acknowledged') return this.view(handoff);
        handoff.state = 'processing';
        handoff.attemptCount += 1;
        handoff.lastFailureReason = null;
        await manager.save(handoff);

        await this.transferPaid(manager, handoff.guestId, handoff.accountId, 'coin_balances', 'coin_ledger_entries', 'coin');
        await this.transferPaid(manager, handoff.guestId, handoff.accountId, 'ai_credit_balances', 'ai_credit_ledger_entries', 'ai_credit');
        await this.transferRewardDayPools(manager, handoff.guestId, handoff.accountId);
        for (const sql of [
          `UPDATE ai.ai_artworks SET account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE ai.ai_credit_reservations SET account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE ai.prompt_safety_attempts SET account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE conversion.pattern_conversions SET account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE conversion.personal_patterns SET owner_account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE catalog.patterns SET owner_account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE economy.commerce_transaction_bindings SET principal_type='account', principal_id=$2, account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE economy.revenuecat_subscriber_mappings SET account_id=$2, guest_installation_id=NULL, updated_at=now() WHERE guest_installation_id=$1`,
          `UPDATE economy.membership_events SET account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE economy.membership_periods SET account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
        ]) await manager.query(sql, [handoff.guestId, handoff.accountId]);
        handoff.state = 'acknowledged';
        await manager.save(handoff);
        return this.view(handoff);
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'commerce promotion failed';
      if (error instanceof NotFoundException) throw error;
      const transient = (error as { code?: string }).code === '40001' || (error as { code?: string }).code === '40P01';
      await this.handoffs.update({ id }, { state: transient ? 'pending' : 'failed', lastFailureReason: message });
      throw error;
    }
  }

  private async transferPaid(manager: EntityManager, guestId: string, accountId: string, balanceTable: 'coin_balances' | 'ai_credit_balances', ledgerTable: 'coin_ledger_entries' | 'ai_credit_ledger_entries', currency: 'coin' | 'ai_credit'): Promise<void> {
    const rows = await manager.query<readonly { paid_balance: string }[]>(`SELECT paid_balance FROM economy.${balanceTable} WHERE principal_type='guest' AND principal_id=$1 FOR UPDATE`, [guestId]);
    const amount = rows[0]?.paid_balance ?? '0';
    if (amount === '0') return;
    const reason = 'commerce_transfer';
    const source = `commerce_promotion:${currency}:${guestId}:${accountId}`;
    const claim = await manager.query<readonly { id: string }[]>(`INSERT INTO economy.${ledgerTable} (principal_type, principal_id, amount, reason, source_key, granted, metadata) VALUES ('account',$1,$2,$3,$4,true,$5) ON CONFLICT ON CONSTRAINT "UQ_${ledgerTable}_source_key" DO NOTHING RETURNING id`, [accountId, amount, reason, source, { guestId, paidTransfer: true }]);
    if (claim.length === 0) return;
    await manager.query(`INSERT INTO economy.${ledgerTable} (principal_type, principal_id, amount, reason, source_key, granted, metadata) VALUES ('guest',$1,$2,$3,$4,true,$5) ON CONFLICT ON CONSTRAINT "UQ_${ledgerTable}_source_key" DO NOTHING`, [guestId, `-${amount}`, reason, `${source}:source`, { accountId, paidTransfer: true }]);
    await manager.query(`INSERT INTO economy.${balanceTable} (principal_type, principal_id, balance, paid_balance) VALUES ('account',$1,$2,$2) ON CONFLICT ON CONSTRAINT "PK_${balanceTable}" DO UPDATE SET balance=${balanceTable}.balance+EXCLUDED.balance, paid_balance=${balanceTable}.paid_balance+EXCLUDED.paid_balance, updated_at=now()`, [accountId, amount]);
    await manager.query(`UPDATE economy.${balanceTable} SET balance=balance-$2, paid_balance=GREATEST(0, paid_balance - GREATEST(0, $2 - GREATEST(0, balance-paid_balance))), updated_at=now() WHERE principal_type='guest' AND principal_id=$1`, [guestId, amount]);
  }

  private async transferRewardDayPools(manager: EntityManager, guestId: string, accountId: string): Promise<void> {
    await manager.query(`
      INSERT INTO economy.reward_day_pools (principal_type, principal_id, reward_day, coins_consumed, ads_completed, premium_claimed)
      SELECT 'account', $2, reward_day, coins_consumed, ads_completed, premium_claimed
      FROM economy.reward_day_pools WHERE principal_type='guest' AND principal_id=$1
      ON CONFLICT ON CONSTRAINT "PK_reward_day_pools" DO UPDATE SET
        coins_consumed = GREATEST(economy.reward_day_pools.coins_consumed, EXCLUDED.coins_consumed),
        ads_completed = GREATEST(economy.reward_day_pools.ads_completed, EXCLUDED.ads_completed),
        premium_claimed = economy.reward_day_pools.premium_claimed OR EXCLUDED.premium_claimed,
        updated_at = now()`, [guestId, accountId]);
    await manager.query(`DELETE FROM economy.reward_day_pools WHERE principal_type='guest' AND principal_id=$1`, [guestId]);
  }

  private view(handoff: CommercePromotionHandoffEntity): CommercePromotionStatus {
    return { handoffId: handoff.id, status: handoff.state, syncingPurchases: handoff.state !== 'acknowledged', attemptCount: handoff.attemptCount, lastFailureReason: handoff.lastFailureReason };
  }
}
