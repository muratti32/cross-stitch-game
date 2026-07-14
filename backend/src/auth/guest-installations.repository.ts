import { Injectable } from '@nestjs/common';
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
