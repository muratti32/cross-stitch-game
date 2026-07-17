import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { returningRows } from '../database/query-results';
import { OperatorRefreshTokenStatus } from './entities';

interface OperatorRefreshTokenRecord {
  familyId: string;
  id: string;
  operatorAccountId: string;
  status: OperatorRefreshTokenStatus;
}

export type OperatorRefreshRotationOutcome =
  | { kind: 'rotated'; operatorAccountId: string }
  | { kind: 'invalid' }
  | { kind: 'reuse-detected'; operatorAccountId: string };

@Injectable()
export class OperatorRefreshTokensRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findOperatorIdByTokenHash(tokenHash: string): Promise<string | null> {
    const token = await this.findByHash(this.dataSource.manager, tokenHash);
    return token === null ? null : token.operatorAccountId;
  }

  async createFamily(
    operatorAccountId: string,
    tokenHash: string,
    familyId: string,
    expiresAt: Date,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      if (!(await this.lockActiveOperator(manager, operatorAccountId))) {
        return false;
      }

      await manager.query(
        `INSERT INTO admin.operator_refresh_tokens (
           operator_account_id, token_hash, family_id, status, expires_at, rotated_at
         )
         VALUES ($1, $2, $3, $4, $5, NULL)
         RETURNING id`,
        [
          operatorAccountId,
          tokenHash,
          familyId,
          OperatorRefreshTokenStatus.Active,
          expiresAt,
        ],
      );
      return true;
    });
  }

  rotate(
    tokenHash: string,
    nextTokenHash: string,
    nextExpiresAt: Date,
  ): Promise<OperatorRefreshRotationOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const initialToken = await this.findByHash(manager, tokenHash);
      if (initialToken === null) {
        return { kind: 'invalid' };
      }

      await this.lockFamily(manager, initialToken.familyId);
      const token = await this.findByHash(manager, tokenHash);
      if (token === null) {
        return { kind: 'invalid' };
      }

      if (
        token.status === OperatorRefreshTokenStatus.Rotated ||
        token.status === OperatorRefreshTokenStatus.Revoked
      ) {
        await this.revokeFamily(manager, token.familyId);
        return { kind: 'reuse-detected', operatorAccountId: token.operatorAccountId };
      }

      if (!(await this.lockActiveOperator(manager, token.operatorAccountId))) {
        await this.revokeFamily(manager, token.familyId);
        return { kind: 'invalid' };
      }

      const rotatedResult: unknown = await manager.query(
        `UPDATE admin.operator_refresh_tokens
         SET status = $2, rotated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = $3 AND expires_at > CURRENT_TIMESTAMP
         RETURNING id`,
        [token.id, OperatorRefreshTokenStatus.Rotated, OperatorRefreshTokenStatus.Active],
      );
      if (returningRows<{ id: string }>(rotatedResult).length !== 1) {
        return { kind: 'invalid' };
      }

      await manager.query(
        `INSERT INTO admin.operator_refresh_tokens (
           operator_account_id, token_hash, family_id, status, expires_at, rotated_at
         )
         VALUES ($1, $2, $3, $4, $5, NULL)
         RETURNING id`,
        [
          token.operatorAccountId,
          nextTokenHash,
          token.familyId,
          OperatorRefreshTokenStatus.Active,
          nextExpiresAt,
        ],
      );

      return { kind: 'rotated', operatorAccountId: token.operatorAccountId };
    });
  }

  async revokeFamilyByTokenHash(tokenHash: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const initialToken = await this.findByHash(manager, tokenHash);
      if (initialToken === null) {
        return;
      }
      await this.lockFamily(manager, initialToken.familyId);
      const token = await this.findByHash(manager, tokenHash);
      if (token !== null) {
        await this.revokeFamily(manager, token.familyId);
      }
    });
  }

  async revokeAllForOperator(operatorAccountId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE admin.operator_refresh_tokens
       SET status = $2
       WHERE operator_account_id = $1 AND status <> $2`,
      [operatorAccountId, OperatorRefreshTokenStatus.Revoked],
    );
  }

  private async findByHash(
    manager: EntityManager,
    tokenHash: string,
  ): Promise<OperatorRefreshTokenRecord | null> {
    const rows = await manager.query<readonly OperatorRefreshTokenRecord[]>(
      `SELECT id,
              operator_account_id AS "operatorAccountId",
              family_id AS "familyId",
              status
       FROM admin.operator_refresh_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  private async lockFamily(manager: EntityManager, familyId: string): Promise<void> {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0)) AS locked',
      [familyId],
    );
  }

  private async lockActiveOperator(
    manager: EntityManager,
    operatorAccountId: string,
  ): Promise<boolean> {
    const rows = await manager.query<readonly { id: string }[]>(
      `SELECT id
       FROM admin.operator_accounts
       WHERE id = $1 AND disabled = false
       FOR SHARE`,
      [operatorAccountId],
    );
    return rows.length === 1;
  }

  private async revokeFamily(manager: EntityManager, familyId: string): Promise<void> {
    await manager.query(
      `UPDATE admin.operator_refresh_tokens
       SET status = $2
       WHERE family_id = $1 AND status <> $2
       RETURNING id`,
      [familyId, OperatorRefreshTokenStatus.Revoked],
    );
  }
}
