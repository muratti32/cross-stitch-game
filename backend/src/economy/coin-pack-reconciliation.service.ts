import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { returningRows } from '../database/query-results';
import { SupportReferenceService } from '../support/support-reference.service';
import {
  type CoinPackProductKey,
  type CoinPackReconciliationDto,
} from './coin-pack-reconciliation.dto';

const STORE_PRODUCT_IDS: Readonly<Record<CoinPackProductKey, string>> = {
  coin_pack_300: 'com.avk.stitchwish.coin_pack_300',
  coin_pack_900: 'com.avk.stitchwish.coin_pack_900',
  coin_pack_2000: 'com.avk.stitchwish.coin_pack_2000',
};

interface ReconciliationRow {
  id: string;
  account_id: string;
  product_key: CoinPackProductKey;
  provider_transaction_id: string;
}

interface BindingRow {
  currency: string;
  environment: string;
  granted_amount: string;
  principal_id: string;
  product_id: string;
}

export type CoinPackReconciliationStatus =
  | { status: 'pending'; balance: null }
  | { status: 'verification_failed'; balance: null }
  | { status: 'grant_failed'; balance: null }
  | { status: 'granted'; balance: number };

@Injectable()
export class CoinPackReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly supportReferences: SupportReferenceService,
  ) {}

  async start(
    principal: AuthPrincipal,
    input: CoinPackReconciliationDto,
  ): Promise<{ id: string; supportReference: string }> {
    this.requireAccount(principal);
    return this.dataSource.transaction(async (manager) => {
      const rows = returningRows<{ id: string }>(await manager.query(
        `INSERT INTO economy.coin_pack_purchase_reconciliations
           (account_id, product_key, provider_transaction_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, product_key, provider_transaction_id)
           DO UPDATE SET provider_transaction_id = EXCLUDED.provider_transaction_id
         RETURNING id`,
        [principal.id, input.productKey, input.transactionIdentifier],
      ));
      const reconciliation = rows[0];
      if (reconciliation === undefined) {
        throw new Error('Coin Pack reconciliation record was not created');
      }

      const existingReferences = await manager.query<readonly { code: string }[]>(
        `SELECT reference.code
         FROM support.support_reference_records record
         JOIN support.support_references reference
           ON reference.id = record.support_reference_id
         WHERE record.record_type = 'coin_pack_purchase_reconciliation'
           AND record.record_id = $1
         ORDER BY reference.created_at ASC
         LIMIT 1`,
        [reconciliation.id],
      );
      const supportReference = existingReferences[0]?.code
        ?? await this.supportReferences.create(manager, {
          principalType: 'account',
          principalId: principal.id,
          records: [{
            type: 'coin_pack_purchase_reconciliation',
            id: reconciliation.id,
          }],
        });
      return { id: reconciliation.id, supportReference };
    });
  }

  async getStatus(
    principal: AuthPrincipal,
    id: string,
  ): Promise<CoinPackReconciliationStatus> {
    this.requireAccount(principal);
    const reconciliations = await this.dataSource.query<readonly ReconciliationRow[]>(
      `SELECT id, account_id, product_key, provider_transaction_id
       FROM economy.coin_pack_purchase_reconciliations
       WHERE id = $1 AND account_id = $2`,
      [id, principal.id],
    );
    const reconciliation = reconciliations[0];
    if (reconciliation === undefined) {
      throw new NotFoundException('Coin Pack reconciliation was not found');
    }

    const bindings = await this.dataSource.query<readonly BindingRow[]>(
      `SELECT environment, principal_id, product_id, currency, granted_amount
       FROM economy.commerce_transaction_bindings
       WHERE provider_transaction_id = $1
       ORDER BY created_at DESC`,
      [reconciliation.provider_transaction_id],
    );
    if (bindings.length === 0) return { status: 'pending', balance: null };

    const expectedProductId = STORE_PRODUCT_IDS[reconciliation.product_key];
    const binding = bindings.find((candidate) =>
      candidate.principal_id === principal.id
      && candidate.product_id === expectedProductId
      && candidate.currency === 'coin');
    if (binding === undefined) {
      return { status: 'verification_failed', balance: null };
    }

    const grants = await this.dataSource.query<readonly { balance: string }[]>(
      `SELECT balance.balance
       FROM economy.coin_ledger_entries entry
       JOIN economy.coin_balances balance
         ON balance.principal_type = entry.principal_type
        AND balance.principal_id = entry.principal_id
       WHERE entry.principal_type = 'account'
         AND entry.principal_id = $1
         AND entry.source_key = $2
         AND entry.reason = 'coin_pack_purchase'
         AND entry.granted = true
         AND entry.amount = $3`,
      [
        principal.id,
        `commerce:${binding.environment}:${reconciliation.provider_transaction_id}`,
        Number(binding.granted_amount),
      ],
    );
    const grant = grants[0];
    return grant === undefined
      ? { status: 'grant_failed', balance: null }
      : { status: 'granted', balance: Number(grant.balance) };
  }

  private requireAccount(principal: AuthPrincipal): void {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('A Registered Account is required for Stitch Coin Packs');
    }
  }
}
