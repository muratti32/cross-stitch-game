import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import { AccountStateService } from './account-state.service';
import { AccountClosureWorkloadService } from './account-closure-workload.service';

export type AccountDeletionStatusView =
  | { status: 'none' }
  | { status: 'pending'; requestedAt: Date; recoveryWindowEndsAt: Date };

@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly accountStateService: AccountStateService,
    private readonly accountClosureWorkloadService: AccountClosureWorkloadService,
  ) {}

  async request(principal: AuthPrincipal): Promise<AccountDeletionStatusView> {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException();
    }

    const nowEpoch = Math.floor(Date.now() / 1000);
    if (principal.authTime === undefined || nowEpoch - principal.authTime > 300) {
      throw new UnauthorizedException('Recent reauthentication required');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const accountRows: readonly { status: string }[] = await manager.query(
        `SELECT status
         FROM auth.registered_accounts
         WHERE id = $1
         FOR UPDATE`,
        [principal.id],
      );

      const account = accountRows[0];
      if (account === undefined) {
        throw new NotFoundException();
      }

      if (account.status === 'closing') {
        const pendingRows: readonly { requestedAt: Date; recoveryWindowEndsAt: Date }[] = await manager.query(
          `SELECT requested_at AS "requestedAt",
                  recovery_window_ends_at AS "recoveryWindowEndsAt"
           FROM deletion.account_deletion_requests
           WHERE account_id = $1 AND status = 'pending'`,
          [principal.id],
        );
        const pending = pendingRows[0];
        if (pending !== undefined) {
          return {
            status: 'pending' as const,
            requestedAt: pending.requestedAt,
            recoveryWindowEndsAt: pending.recoveryWindowEndsAt,
          };
        }
      } else if (account.status !== 'active') {
        throw new ConflictException('Account cannot be deleted');
      }

      const insertRows: readonly { id: string; requestedAt: Date; recoveryWindowEndsAt: Date }[] = await manager.query(
        `INSERT INTO deletion.account_deletion_requests (account_id, recovery_window_ends_at)
         VALUES ($1, now() + interval '30 days')
         RETURNING id, requested_at AS "requestedAt", recovery_window_ends_at AS "recoveryWindowEndsAt"`,
        [principal.id],
      );

      const requestRow = insertRows[0];
      if (requestRow === undefined) {
        throw new Error('Failed to insert account deletion request');
      }

      await manager.query(
        `UPDATE auth.registered_accounts
         SET status = 'closing'
         WHERE id = $1`,
        [principal.id],
      );

      await manager.query(
        `UPDATE moderation.creator_profiles
         SET closure_hold_at = now()
         WHERE account_id = $1 AND closure_hold_at IS NULL`,
        [principal.id],
      );

      const counts = await this.accountClosureWorkloadService.cancelUnsubmittedWork(
        principal.id,
        manager,
      );

      await manager.query(
        `INSERT INTO deletion.deletion_audit_events (request_id, event, details)
         VALUES ($1, 'deletion_requested', '{}'::jsonb)`,
        [requestRow.id],
      );

      await manager.query(
        `INSERT INTO deletion.deletion_audit_events (request_id, event, details)
         VALUES ($1, 'closure_workload_cancelled', $2::jsonb)`,
        [requestRow.id, JSON.stringify(counts)],
      );

      return {
        status: 'pending' as const,
        requestedAt: requestRow.requestedAt,
        recoveryWindowEndsAt: requestRow.recoveryWindowEndsAt,
      };
    });

    this.accountStateService.invalidate(principal.id);

    await this.refreshTokensRepository.revokeAllForPrincipal(
      principal.type,
      principal.id,
    );

    return result;
  }

  async cancel(principal: AuthPrincipal): Promise<AccountDeletionStatusView> {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException();
    }

    const nowEpoch = Math.floor(Date.now() / 1000);
    if (principal.authTime === undefined || nowEpoch - principal.authTime > 300) {
      throw new UnauthorizedException('Recent reauthentication required');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const accountRows: readonly { status: string }[] = await manager.query(
        `SELECT status
         FROM auth.registered_accounts
         WHERE id = $1
         FOR UPDATE`,
        [principal.id],
      );

      const account = accountRows[0];
      if (account === undefined) {
        throw new NotFoundException();
      }

      const pendingRows: readonly { id: string; recoveryWindowEndsAt: Date }[] = await manager.query(
        `SELECT id, recovery_window_ends_at AS "recoveryWindowEndsAt"
         FROM deletion.account_deletion_requests
         WHERE account_id = $1 AND status = 'pending'
         FOR UPDATE`,
        [principal.id],
      );

      const pending = pendingRows[0];
      if (pending === undefined) {
        throw new NotFoundException('No pending Account Deletion Request');
      }

      const now = new Date();
      if (pending.recoveryWindowEndsAt.getTime() <= now.getTime()) {
        throw new ConflictException('Deletion Recovery Window has expired');
      }

      await manager.query(
        `UPDATE deletion.account_deletion_requests
         SET status = 'cancelled',
             cancelled_at = now()
         WHERE id = $1`,
        [pending.id],
      );

      await manager.query(
        `UPDATE auth.registered_accounts
         SET status = 'active'
         WHERE id = $1`,
        [principal.id],
      );

      await manager.query(
        `UPDATE moderation.creator_profiles
         SET closure_hold_at = NULL
         WHERE account_id = $1`,
        [principal.id],
      );

      await manager.query(
        `INSERT INTO deletion.deletion_audit_events (request_id, event, details)
         VALUES ($1, 'deletion_cancelled', '{}'::jsonb)`,
        [pending.id],
      );

      return { status: 'none' as const };
    });

    this.accountStateService.invalidate(principal.id);

    return result;
  }

  async getStatus(principal: AuthPrincipal): Promise<AccountDeletionStatusView> {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException();
    }

    const rows: readonly { requestedAt: Date; recoveryWindowEndsAt: Date }[] = await this.dataSource.query(
      `SELECT requested_at AS "requestedAt",
              recovery_window_ends_at AS "recoveryWindowEndsAt"
       FROM deletion.account_deletion_requests
       WHERE account_id = $1 AND status = 'pending'`,
      [principal.id],
    );

    const pending = rows[0];
    if (pending === undefined) {
      return { status: 'none' };
    }

    return {
      status: 'pending',
      requestedAt: pending.requestedAt,
      recoveryWindowEndsAt: pending.recoveryWindowEndsAt,
    };
  }
}
