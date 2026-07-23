import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { returningRows } from '../database/query-results';
import type { LedgerPrincipal } from './coin-ledger.repository';

@Injectable()
export class AdAttemptRepository {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    principal: LedgerPrincipal,
    placement: string,
    ttlSeconds: number,
  ): Promise<{ nonce: string; expiresAt: Date }> {
    const rows = returningRows<{ nonce: string; expires_at: Date }>(
      await this.dataSource.query(
        `INSERT INTO economy.ad_attempts (principal_type, principal_id, placement, expires_at)
         VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)
         RETURNING nonce, expires_at`,
        [principal.type, principal.id, placement, String(ttlSeconds)],
      ),
    );
    return {
      nonce: rows[0].nonce,
      expiresAt: new Date(rows[0].expires_at),
    };
  }

  async consume(nonce: string): Promise<LedgerPrincipal | null> {
    const rows = returningRows<{ principal_type: 'guest' | 'account'; principal_id: string }>(
      await this.dataSource.query(
        `UPDATE economy.ad_attempts
         SET consumed_at = now()
         WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > now()
         RETURNING principal_type, principal_id`,
        [nonce],
      ),
    );
    if (rows.length === 0) {
      return null;
    }
    return {
      type: rows[0].principal_type,
      id: rows[0].principal_id,
    };
  }
}
