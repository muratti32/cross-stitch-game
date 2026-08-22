import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AiGuestPurgeRepository } from '../ai-artwork/ai-guest-purge.repository';
import { CatalogGuestPurgeRepository } from '../catalog/catalog-guest-purge.repository';
import { ConversionGuestPurgeRepository } from '../conversion/conversion-guest-purge.repository';
import { returningRows } from '../database/query-results';
import { EconomyGuestPurgeRepository } from '../economy/economy-guest-purge.repository';
import { SessionsGuestPurgeRepository } from '../sessions/sessions-guest-purge.repository';
import { GuestInstallationStatus } from './entities';

export interface GuestInstallationRecord {
  credentialHash: string;
  id: string;
  status: GuestInstallationStatus;
}

@Injectable()
export class GuestInstallationsRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly economyPurge: EconomyGuestPurgeRepository,
    private readonly aiPurge: AiGuestPurgeRepository,
    private readonly conversionPurge: ConversionGuestPurgeRepository,
    private readonly catalogPurge: CatalogGuestPurgeRepository,
    private readonly sessionsPurge: SessionsGuestPurgeRepository,
  ) {}

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

  /**
   * Confirmed Guest Data Reset. Each bounded context erases its own rows
   * through its purge repository; this method owns only the `auth` schema and
   * the transaction the whole reset shares. The revoked installation row stays
   * behind, so provider-transaction bindings and grant tombstones keep
   * pointing at an identity that can never be signed in to again.
   */
  async reset(id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const activeRows = await manager.query<readonly { status: GuestInstallationStatus }[]>(
        `SELECT status FROM auth.guest_installations WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (activeRows[0]?.status === GuestInstallationStatus.Active) {
        await this.economyPurge.assertNoUnresolvedPurchaseAttempt(manager, id);
      }

      await this.economyPurge.purgeGuest(manager, id);
      await this.aiPurge.purgeGuest(manager, id);
      await this.conversionPurge.purgeGuest(manager, id);
      await this.catalogPurge.purgeGuest(manager, id);
      await this.sessionsPurge.purgeGuest(manager, id);

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
