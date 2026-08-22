import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuthHashingService } from '../auth/auth-hashing.service';
import { GuestInstallationsRepository } from '../auth/guest-installations.repository';
import { GuestInstallationStatus } from '../auth/entities/guest-installation-status.enum';
import { CommercePromotionHandoffEntity } from './entities';

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
  ) {}

  async start(accountId: string, guestId: string, credential: string): Promise<CommercePromotionStatus> {
    const guest = await this.guests.findOneById(guestId);
    if (!guest) throw new NotFoundException('Guest installation not found');
    if (!(await this.hashing.verifyCredentialSecret(credential, guest.credentialHash))) {
      throw new UnauthorizedException('Invalid guest credentials');
    }
    if (guest.status === GuestInstallationStatus.Revoked) throw new ConflictException('Guest installation has already been consumed');
    const existing = await this.handoffs.findOne({ where: { guestId, accountId } });
    const handoff = existing ?? this.handoffs.create({ guestId, accountId, state: 'pending', attemptCount: 0, lastFailureReason: null });
    await this.handoffs.save(handoff);
    return this.process(handoff.id);
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

  private async process(id: string): Promise<CommercePromotionStatus> {
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
        for (const sql of [
          `UPDATE ai.ai_artworks SET account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE ai.ai_credit_reservations SET account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE ai.prompt_safety_attempts SET account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE conversion.pattern_conversions SET account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE conversion.personal_patterns SET owner_account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE catalog.patterns SET owner_account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE economy.commerce_transaction_bindings SET principal_type='account', principal_id=$2, account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE economy.membership_events SET account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
          `UPDATE economy.membership_periods SET account_id=$2, guest_installation_id=NULL WHERE guest_installation_id=$1`,
        ]) await manager.query(sql, [handoff.guestId, handoff.accountId]);
        handoff.state = 'acknowledged';
        await manager.save(handoff);
        return this.view(handoff);
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'commerce promotion failed';
      await this.handoffs.update({ id }, { state: 'failed', lastFailureReason: message });
      throw error;
    }
  }

  private async transferPaid(manager: import('typeorm').EntityManager, guestId: string, accountId: string, balanceTable: 'coin_balances' | 'ai_credit_balances', ledgerTable: 'coin_ledger_entries' | 'ai_credit_ledger_entries', currency: 'coin' | 'ai_credit'): Promise<void> {
    const rows = await manager.query<readonly { paid_balance: string }[]>(`SELECT paid_balance FROM economy.${balanceTable} WHERE principal_type='guest' AND principal_id=$1 FOR UPDATE`, [guestId]);
    const amount = Number(rows[0]?.paid_balance ?? 0);
    if (amount <= 0) return;
    const reason = 'commerce_transfer';
    const source = `commerce_promotion:${currency}:${guestId}:${accountId}`;
    const claim = await manager.query<readonly { id: string }[]>(`INSERT INTO economy.${ledgerTable} (principal_type, principal_id, amount, reason, source_key, granted, metadata) VALUES ('account',$1,$2,$3,$4,true,$5) ON CONFLICT DO NOTHING RETURNING id`, [accountId, amount, reason, source, { guestId, paidTransfer: true }]);
    if (claim.length === 0) return;
    await manager.query(`INSERT INTO economy.${ledgerTable} (principal_type, principal_id, amount, reason, source_key, granted, metadata) VALUES ('guest',$1,$2,$3,$4,true,$5) ON CONFLICT DO NOTHING`, [guestId, -amount, reason, `${source}:source`, { accountId, paidTransfer: true }]);
    await manager.query(`INSERT INTO economy.${balanceTable} (principal_type, principal_id, balance, paid_balance) VALUES ('account',$1,$2,$2) ON CONFLICT ON CONSTRAINT "PK_${balanceTable}" DO UPDATE SET balance=${balanceTable}.balance+EXCLUDED.balance, paid_balance=${balanceTable}.paid_balance+EXCLUDED.paid_balance, updated_at=now()`, [accountId, amount]);
    await manager.query(`UPDATE economy.${balanceTable} SET balance=balance-$2, paid_balance=0, updated_at=now() WHERE principal_type='guest' AND principal_id=$1`, [guestId, amount]);
  }

  private view(handoff: CommercePromotionHandoffEntity): CommercePromotionStatus {
    return { handoffId: handoff.id, status: handoff.state, syncingPurchases: handoff.state !== 'acknowledged', attemptCount: handoff.attemptCount, lastFailureReason: handoff.lastFailureReason };
  }
}
