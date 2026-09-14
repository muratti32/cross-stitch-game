import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { CoinLedgerReason } from './entities';
import { InsufficientCoinError, LedgerPrincipal } from './coin-ledger.repository';

export const LOCATOR_PRICE_COIN = 1;
export const LOCATOR_RESERVATION_TTL_SECONDS = 60;

export interface PrepareLocatorAttemptInput {
  attemptId: string;
  sessionId: string;
  patternId: string;
  colorIndex: number;
  dmcCode: string;
  progressRevision?: number;
  progressHash?: string;
}

export interface CommitLocatorAttemptInput {
  targetCellIndex: number;
  progressRevision?: number;
  progressHash?: string;
}

export interface LocatorAttemptView {
  attemptId: string;
  status: 'prepared' | 'committed' | 'released' | 'expired' | 'rejected';
  price: number;
  balance: number;
  expiresAt: string;
  targetCellIndex: number | null;
}

interface AttemptRow {
  attempt_id: string;
  principal_type: 'guest' | 'account';
  principal_id: string;
  session_id: string;
  pattern_id: string;
  color_index: number;
  dmc_code: string;
  target_cell_index: number | null;
  progress_revision: string | null;
  progress_hash: string | null;
  reserved_paid_amount: string;
  status: LocatorAttemptView['status'];
  reserved_until: Date | string;
  terminal_at: Date | string | null;
}

interface BalanceRow { balance: string; }

@Injectable()
export class LocatorAttemptService {
  constructor(private readonly dataSource: DataSource) {}

  async prepare(principal: AuthPrincipal, input: PrepareLocatorAttemptInput): Promise<LocatorAttemptView> {
    const owner = toLedgerPrincipal(principal);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.expirePreparedAttempts(manager, owner);

        const existing = await this.findAttempt(manager, input.attemptId, true);
        if (existing) {
          this.assertOwner(existing, owner);
          this.assertSameContext(existing, input);
          return this.view(existing, await this.readBalance(manager, owner));
        }

        const sessions = await manager.query<readonly { principal_type: string; principal_id: string; pattern_id: string; status: string }[]>(
          `SELECT principal_type, principal_id, pattern_id, status
           FROM sessions.stitching_sessions WHERE id = $1 FOR UPDATE`,
          [input.sessionId],
        );
        const session = sessions[0];
        if (!session) throw new NotFoundException('Session not found');
        if (session.principal_type !== owner.type || session.principal_id !== owner.id) {
          throw new ForbiddenException('Forbidden: Owner only');
        }
        if (session.status !== 'active') throw new ConflictException({ code: 'session_inactive' });
        if (session.pattern_id !== input.patternId) throw new ConflictException({ code: 'pattern_mismatch' });

        // The session row lock serializes two devices preparing the same
        // session before the partial unique index is reached.
        const active = await manager.query<AttemptRow[]>(
          `SELECT * FROM economy.locator_attempts
           WHERE principal_type = $1 AND principal_id = $2 AND session_id = $3 AND status = 'prepared'
           FOR UPDATE`,
          [owner.type, owner.id, input.sessionId],
        );
        if (active[0]) {
          this.assertSameContext(active[0], input);
          return this.view(active[0], await this.readBalance(manager, owner));
        }

        const recent = await manager.query<readonly { count: string }[]>(
          `SELECT count(*)::text AS count FROM economy.locator_attempts
           WHERE principal_type = $1 AND principal_id = $2
             AND created_at > now() - interval '1 minute'`,
          [owner.type, owner.id],
        );
        if (Number(recent[0]?.count ?? 0) >= 30) {
          throw new HttpException({ code: 'locator_rate_limited' }, HttpStatus.TOO_MANY_REQUESTS);
        }

        const balanceRows = await manager.query<readonly (BalanceRow & { paid_balance: string })[]>(
          `SELECT balance, paid_balance FROM economy.coin_balances
           WHERE principal_type = $1 AND principal_id = $2 FOR UPDATE`,
          [owner.type, owner.id],
        );
        const balance = Number(balanceRows[0]?.balance ?? 0);
        if (balance < LOCATOR_PRICE_COIN) throw new InsufficientCoinError(LOCATOR_PRICE_COIN, balance);
        const paidBalance = Number(balanceRows[0]?.paid_balance ?? 0);
        const paidDebit = Math.max(0, LOCATOR_PRICE_COIN - Math.max(0, balance - paidBalance));

        const expiresAt = new Date(Date.now() + LOCATOR_RESERVATION_TTL_SECONDS * 1000);
        const inserted = await manager.query<AttemptRow[]>(
          `INSERT INTO economy.locator_attempts
             (attempt_id, principal_type, principal_id, session_id, pattern_id, color_index, dmc_code,
              progress_revision, progress_hash, reserved_paid_amount, status, reserved_until, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'prepared', $11, $12)
           RETURNING *`,
          [
            input.attemptId, owner.type, owner.id, input.sessionId, input.patternId,
            input.colorIndex, input.dmcCode, input.progressRevision ?? null,
            input.progressHash ?? null, paidDebit, expiresAt, { sessionId: input.sessionId, patternId: input.patternId },
          ],
        );
        await manager.query(
          `UPDATE economy.coin_balances
           SET balance = balance - $3, paid_balance = paid_balance - $4, updated_at = now()
           WHERE principal_type = $1 AND principal_id = $2`,
          [owner.type, owner.id, LOCATOR_PRICE_COIN, paidDebit],
        );
        await manager.query(
          `INSERT INTO economy.coin_ledger_entries
             (principal_type, principal_id, amount, reason, source_key, granted, metadata)
           VALUES ($1, $2, 0, $3, $4, true, $5)`,
          [owner.type, owner.id, CoinLedgerReason.LocatorSpend, `locator:${input.attemptId}:reserve`, { action: 'reserve', price: LOCATOR_PRICE_COIN, ...input }],
        );
        return this.view(inserted[0], balance - LOCATOR_PRICE_COIN);
      });
    } catch (error) {
      if (error instanceof InsufficientCoinError) {
        throw new ConflictException({ code: 'insufficient_balance', price: error.price, balance: error.balance });
      }
      throw error;
    }
  }

  async commit(principal: AuthPrincipal, attemptId: string, input: CommitLocatorAttemptInput): Promise<LocatorAttemptView> {
    return this.dataSource.transaction(async (manager) => {
      const owner = toLedgerPrincipal(principal);
      const attempt = await this.requireAttempt(manager, attemptId, true);
      this.assertOwner(attempt, owner);
      if (attempt.status === 'committed') return this.view(attempt, await this.readBalance(manager, owner));
      if (attempt.status !== 'prepared') throw new ConflictException({ code: 'locator_attempt_terminal', status: attempt.status });
      if (new Date(attempt.reserved_until).getTime() <= Date.now()) {
        return this.releaseLocked(manager, attempt, owner, 'expired');
      }
      const updated = await manager.query<AttemptRow[]>(
        `UPDATE economy.locator_attempts
         SET status = 'committed', target_cell_index = $2, progress_revision = $3,
             progress_hash = $4, terminal_at = now(), metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
             updated_at = now()
         WHERE attempt_id = $1 AND status = 'prepared'
         RETURNING *`,
        [attemptId, input.targetCellIndex, input.progressRevision ?? attempt.progress_revision, input.progressHash ?? attempt.progress_hash,
          JSON.stringify({ targetCellIndex: input.targetCellIndex, committedAt: new Date().toISOString() })],
      );
      if (!updated[0]) throw new ConflictException({ code: 'locator_attempt_terminal' });
      await manager.query(
        `INSERT INTO economy.coin_ledger_entries
           (principal_type, principal_id, amount, reason, source_key, granted, metadata)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         ON CONFLICT (source_key) DO NOTHING`,
        [owner.type, owner.id, -LOCATOR_PRICE_COIN, CoinLedgerReason.LocatorSpend, `locator:${attemptId}:commit`, { action: 'commit', ...input }],
      );
      return this.view(updated[0], await this.readBalance(manager, owner));
    });
  }

  async release(principal: AuthPrincipal, attemptId: string): Promise<LocatorAttemptView> {
    return this.dataSource.transaction(async (manager) => {
      const owner = toLedgerPrincipal(principal);
      const attempt = await this.requireAttempt(manager, attemptId, true);
      this.assertOwner(attempt, owner);
      // A cancellation can race a commit already accepted by the backend.
      // Releasing a committed attempt compensates that commit, so cancellation
      // remains charge-free while the ledger retains an auditable reversal.
      if (attempt.status !== 'prepared' && attempt.status !== 'committed') {
        return this.view(attempt, await this.readBalance(manager, owner));
      }
      const terminal = attempt.status === 'prepared'
        && new Date(attempt.reserved_until).getTime() <= Date.now()
        ? 'expired'
        : 'released';
      return this.releaseLocked(manager, attempt, owner, terminal);
    });
  }

  async status(principal: AuthPrincipal, attemptId: string): Promise<LocatorAttemptView> {
    return this.dataSource.transaction(async (manager) => {
      const owner = toLedgerPrincipal(principal);
      const attempt = await this.requireAttempt(manager, attemptId, true);
      this.assertOwner(attempt, owner);
      if (attempt.status === 'prepared' && new Date(attempt.reserved_until).getTime() <= Date.now()) {
        return this.releaseLocked(manager, attempt, owner, 'expired');
      }
      return this.view(attempt, await this.readBalance(manager, owner));
    });
  }

  private async expirePreparedAttempts(manager: EntityManager, owner: LedgerPrincipal): Promise<void> {
    const rows = await manager.query<AttemptRow[]>(
      `SELECT * FROM economy.locator_attempts
       WHERE principal_type = $1 AND principal_id = $2 AND status = 'prepared' AND reserved_until <= now()
       FOR UPDATE`,
      [owner.type, owner.id],
    );
    for (const row of rows) await this.releaseLocked(manager, row, owner, 'expired');
  }

  private async releaseLocked(manager: EntityManager, attempt: AttemptRow, owner: LedgerPrincipal, status: 'released' | 'expired'): Promise<LocatorAttemptView> {
    const updated = await manager.query<AttemptRow[]>(
      `UPDATE economy.locator_attempts SET status = $2, terminal_at = now(), updated_at = now()
       WHERE attempt_id = $1 AND status IN ('prepared', 'committed') RETURNING *`,
      [attempt.attempt_id, status],
    );
    const row = updated[0] ?? attempt;
    if (updated[0]) {
      await manager.query(
        `UPDATE economy.coin_balances
         SET balance = balance + $3, paid_balance = paid_balance + $4, updated_at = now()
         WHERE principal_type = $1 AND principal_id = $2`,
        [owner.type, owner.id, LOCATOR_PRICE_COIN, Number(attempt.reserved_paid_amount ?? 0)],
      );
      await manager.query(
        `INSERT INTO economy.coin_ledger_entries
           (principal_type, principal_id, amount, reason, source_key, granted, metadata)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         ON CONFLICT (source_key) DO NOTHING`,
          [owner.type, owner.id, LOCATOR_PRICE_COIN, CoinLedgerReason.LocatorSpend, `locator:${attempt.attempt_id}:release`, {
            action: attempt.status === 'committed' ? 'cancel_after_commit' : status,
          }],
      );
    }
    return this.view(row, await this.readBalance(manager, owner));
  }

  private async findAttempt(manager: EntityManager, attemptId: string, lock: boolean): Promise<AttemptRow | null> {
    const rows = await manager.query<AttemptRow[]>(
      `SELECT * FROM economy.locator_attempts WHERE attempt_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [attemptId],
    );
    return rows[0] ?? null;
  }

  private async requireAttempt(manager: EntityManager, attemptId: string, lock: boolean): Promise<AttemptRow> {
    const attempt = await this.findAttempt(manager, attemptId, lock);
    if (!attempt) throw new NotFoundException('Locator attempt not found');
    return attempt;
  }

  private async readBalance(manager: EntityManager, owner: LedgerPrincipal): Promise<number> {
    const rows = await manager.query<readonly BalanceRow[]>(
      `SELECT balance FROM economy.coin_balances WHERE principal_type = $1 AND principal_id = $2`,
      [owner.type, owner.id],
    );
    return Number(rows[0]?.balance ?? 0);
  }

  private assertOwner(attempt: AttemptRow, owner: LedgerPrincipal): void {
    if (attempt.principal_type !== owner.type || attempt.principal_id !== owner.id) {
      throw new ForbiddenException('Forbidden: Owner only');
    }
  }

  private assertSameContext(attempt: AttemptRow, input: PrepareLocatorAttemptInput): void {
    if (attempt.session_id !== input.sessionId || attempt.pattern_id !== input.patternId || attempt.color_index !== input.colorIndex || attempt.dmc_code !== input.dmcCode) {
      throw new ConflictException({ code: 'locator_context_stale' });
    }
  }

  private view(attempt: AttemptRow, balance: number): LocatorAttemptView {
    return {
      attemptId: attempt.attempt_id,
      status: attempt.status,
      price: LOCATOR_PRICE_COIN,
      balance,
      expiresAt: new Date(attempt.reserved_until).toISOString(),
      targetCellIndex: attempt.target_cell_index,
    };
  }
}

function toLedgerPrincipal(principal: AuthPrincipal): LedgerPrincipal {
  return { type: principal.type === PrincipalType.Account ? 'account' : 'guest', id: principal.id };
}
