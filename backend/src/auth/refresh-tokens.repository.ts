import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { returningRows } from '../database/query-results';
import {
  GuestInstallationStatus,
  PrincipalType,
  RefreshTokenStatus,
} from './entities';

function isKnownPrincipalType(value: PrincipalType): boolean {
  return value === PrincipalType.Guest || value === PrincipalType.Account;
}

interface RefreshTokenRecord {
  familyId: string;
  id: string;
  principalId: string;
  principalType: PrincipalType;
  status: RefreshTokenStatus;
}

export type RefreshRotationOutcome =
  | {
      kind: 'rotated';
      principalId: string;
      principalType: PrincipalType;
    }
  | { kind: 'invalid' }
  | { kind: 'reuse-detected' };

export interface RefreshTokenPrincipal {
  principalId: string;
  principalType: PrincipalType;
}

@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findPrincipalByTokenHash(
    tokenHash: string,
  ): Promise<RefreshTokenPrincipal | null> {
    const token = await this.findByHash(this.dataSource.manager, tokenHash);
    if (token === null || !isKnownPrincipalType(token.principalType)) {
      return null;
    }
    return {
      principalId: token.principalId,
      principalType: token.principalType,
    };
  }

  async getFamilyAuthTime(tokenHash: string): Promise<number | null> {
    const token = await this.findByHash(this.dataSource.manager, tokenHash);
    if (token === null) {
      return null;
    }
    const rows = await this.dataSource.manager.query<{ createdAt: Date }[]>(
      `SELECT MIN(created_at) AS "createdAt"
       FROM auth.refresh_tokens
       WHERE family_id = $1`,
      [token.familyId],
    );
    const date = rows[0]?.createdAt;
    return date ? Math.floor(new Date(date).getTime() / 1000) : null;
  }

  async createFamily(
    principalType: PrincipalType,
    principalId: string,
    tokenHash: string,
    familyId: string,
    expiresAt: Date,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      if (
        !(await this.lockActivePrincipal(
          manager,
          principalType,
          principalId,
        ))
      ) {
        return false;
      }

      await manager.query<readonly { id: string }[]>(
        `INSERT INTO auth.refresh_tokens (
           principal_type,
           principal_id,
           token_hash,
           family_id,
           status,
           expires_at,
           rotated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, NULL)
         RETURNING id`,
        [
          principalType,
          principalId,
          tokenHash,
          familyId,
          RefreshTokenStatus.Active,
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
  ): Promise<RefreshRotationOutcome> {
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
        token.status === RefreshTokenStatus.Rotated ||
        token.status === RefreshTokenStatus.Revoked
      ) {
        await this.revokeFamily(manager, token.familyId);
        return { kind: 'reuse-detected' };
      }

      if (!isKnownPrincipalType(token.principalType)) {
        return { kind: 'invalid' };
      }

      if (
        !(await this.lockActivePrincipal(
          manager,
          token.principalType,
          token.principalId,
        ))
      ) {
        await this.revokeFamily(manager, token.familyId);
        return { kind: 'invalid' };
      }

      const rotatedResult: unknown = await manager.query(
        `UPDATE auth.refresh_tokens
         SET status = $2,
             rotated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND status = $3
           AND expires_at > CURRENT_TIMESTAMP
         RETURNING id`,
        [
          token.id,
          RefreshTokenStatus.Rotated,
          RefreshTokenStatus.Active,
        ],
      );
      if (returningRows<{ id: string }>(rotatedResult).length !== 1) {
        return { kind: 'invalid' };
      }

      await manager.query<readonly { id: string }[]>(
        `INSERT INTO auth.refresh_tokens (
           principal_type,
           principal_id,
           token_hash,
           family_id,
           status,
           expires_at,
           rotated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, NULL)
         RETURNING id`,
        [
          token.principalType,
          token.principalId,
          nextTokenHash,
          token.familyId,
          RefreshTokenStatus.Active,
          nextExpiresAt,
        ],
      );

      return {
        kind: 'rotated',
        principalId: token.principalId,
        principalType: token.principalType,
      };
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

  private async findByHash(
    manager: EntityManager,
    tokenHash: string,
  ): Promise<RefreshTokenRecord | null> {
    const rows = await manager.query<readonly RefreshTokenRecord[]>(
      `SELECT id,
              principal_type AS "principalType",
              principal_id AS "principalId",
              family_id AS "familyId",
              status
       FROM auth.refresh_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  private async lockFamily(
    manager: EntityManager,
    familyId: string,
  ): Promise<void> {
    await manager.query<readonly { locked: null }[]>(
      `SELECT pg_advisory_xact_lock(
         hashtextextended($1::text, 0)
       ) AS locked`,
      [familyId],
    );
  }

  private async lockActivePrincipal(
    manager: EntityManager,
    principalType: PrincipalType,
    principalId: string,
  ): Promise<boolean> {
    if (principalType === PrincipalType.Guest) {
      const rows = await manager.query<readonly { id: string }[]>(
        `SELECT id
         FROM auth.guest_installations
         WHERE id = $1 AND status = $2
         FOR SHARE`,
        [principalId, GuestInstallationStatus.Active],
      );
      return rows.length === 1;
    }

    if (principalType === PrincipalType.Account) {
      const rows = await manager.query<readonly { id: string }[]>(
        `SELECT id
         FROM auth.registered_accounts
         WHERE id = $1 AND status = 'active'
         FOR SHARE`,
        [principalId],
      );
      return rows.length === 1;
    }

    return false;
  }

  private async revokeFamily(
    manager: EntityManager,
    familyId: string,
  ): Promise<void> {
    await manager.query<readonly { id: string }[]>(
      `UPDATE auth.refresh_tokens
       SET status = $2
       WHERE family_id = $1 AND status <> $2
       RETURNING id`,
      [familyId, RefreshTokenStatus.Revoked],
    );
  }
}
