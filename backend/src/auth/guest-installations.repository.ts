import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { returningRows } from '../database/query-results';
import { GuestInstallationStatus } from './entities';

export interface GuestInstallationRecord {
  credentialHash: string;
  id: string;
  status: GuestInstallationStatus;
}

@Injectable()
export class GuestInstallationsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByInstallationKeyHash(
    installationKeyHash: string,
  ): Promise<GuestInstallationRecord | null> {
    const rows = await this.dataSource.query<
      readonly GuestInstallationRecord[]
    >(
      `SELECT id,
              credential_hash AS "credentialHash",
              status
       FROM auth.guest_installations
       WHERE installation_key_hash = $1`,
      [installationKeyHash],
    );
    return rows[0] ?? null;
  }

  async findOneById(id: string): Promise<GuestInstallationRecord | null> {
    const rows = await this.dataSource.query<
      readonly GuestInstallationRecord[]
    >(
      `SELECT id,
              credential_hash AS "credentialHash",
              status
       FROM auth.guest_installations
       WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async insertIfAbsent(
    installationKeyHash: string,
    credentialHash: string,
  ): Promise<GuestInstallationRecord | null> {
    const rows = await this.dataSource.query<
      readonly GuestInstallationRecord[]
    >(
      `INSERT INTO auth.guest_installations (
         installation_key_hash,
         credential_hash,
         status
       )
       VALUES ($1, $2, $3)
       ON CONFLICT (installation_key_hash) DO NOTHING
       RETURNING id,
                 credential_hash AS "credentialHash",
                 status`,
      [installationKeyHash, credentialHash, GuestInstallationStatus.Active],
    );
    return rows[0] ?? null;
  }

  async touchIfActive(id: string): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE auth.guest_installations
       SET last_seen_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = $2
       RETURNING id`,
      [id, GuestInstallationStatus.Active],
    );
    return returningRows<{ id: string }>(result).length === 1;
  }

  async reset(id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const activeRows = await manager.query<readonly { status: GuestInstallationStatus }[]>(
        `SELECT status FROM auth.guest_installations WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (activeRows[0]?.status === GuestInstallationStatus.Active) {
        const pendingRows = await manager.query<readonly { id: string }[]>(
          `SELECT id
           FROM economy.purchase_attempts
           WHERE principal_type = 'guest' AND principal_id = $1
             AND status IN ('created', 'verifying')
           LIMIT 1
           FOR UPDATE`,
          [id],
        );
        if (pendingRows.length > 0) {
          throw new ConflictException(
            'Guest Data Reset is unavailable while a Purchase Attempt is unresolved',
          );
        }
      }

      // Keep the revoked installation row and its provider-transaction
      // bindings as non-regrant tombstones. All mutable Guest state is removed
      // so a fresh installation can restore Premium only; consumables remain
      // bound to the old identity and can never be minted again.
      await manager.query(
        `DELETE FROM economy.membership_events
         WHERE guest_installation_id = $1`,
        [id],
      );
      await manager.query(
        `DELETE FROM economy.membership_periods
         WHERE guest_installation_id = $1`,
        [id],
      );
      await manager.query(
        `DELETE FROM economy.premium_purchase_reconciliations
         WHERE guest_installation_id = $1`,
        [id],
      );
      await manager.query(
        `DELETE FROM economy.purchase_attempts
         WHERE principal_type = 'guest' AND principal_id = $1`,
        [id],
      );
      await manager.query(
        `DELETE FROM economy.revenuecat_subscriber_mappings
         WHERE guest_installation_id = $1`,
        [id],
      );
      for (const table of [
        'economy.coin_ledger_entries',
        'economy.ai_credit_ledger_entries',
        'economy.coin_balances',
        'economy.ai_credit_balances',
        'economy.reward_day_pools',
        'economy.gameplay_events',
        'economy.daily_color_action_counts',
        'economy.ad_attempts',
        'economy.pattern_unlocks',
      ]) {
        await manager.query(
          `DELETE FROM ${table} WHERE principal_type = 'guest' AND principal_id = $1`,
          [id],
        );
      }
      for (const [table, column] of [
        ['ai.ai_credit_reservations', 'guest_installation_id'],
        ['ai.ai_artworks', 'guest_installation_id'],
        ['ai.prompt_safety_attempts', 'guest_installation_id'],
        ['conversion.pattern_conversions', 'guest_installation_id'],
        ['conversion.personal_patterns', 'guest_installation_id'],
        ['catalog.patterns', 'guest_installation_id'],
      ] as const) {
        await manager.query(`DELETE FROM ${table} WHERE ${column} = $1`, [id]);
      }
      await manager.query(
        `DELETE FROM sessions.stitching_sessions
         WHERE principal_type = 'guest' AND principal_id = $1`,
        [id],
      );

      await manager.query(
        `UPDATE auth.guest_installations
         SET status = $2
         WHERE id = $1 AND status <> $2`,
        [id, GuestInstallationStatus.Revoked],
      );

      await manager.query(
        `UPDATE auth.refresh_tokens
         SET status = 'revoked'
         WHERE principal_type = 'guest'
           AND principal_id = $1
           AND status <> 'revoked'`,
        [id],
      );
    });
  }
}
