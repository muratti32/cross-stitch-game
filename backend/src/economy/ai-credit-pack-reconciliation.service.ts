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
  type AiCreditPackProductKey,
  type AiCreditPackReconciliationDto,
} from './ai-credit-pack-reconciliation.dto';

const STORE_PRODUCT_IDS: Readonly<Record<AiCreditPackProductKey, string>> = {
  ai_credit_pack_5: 'com.avk.stitchwish.ai_credit_pack_5',
  ai_credit_pack_20: 'com.avk.stitchwish.ai_credit_pack_20',
  ai_credit_pack_50: 'com.avk.stitchwish.ai_credit_pack_50',
};

interface ReconciliationRow {
  id: string;
  account_id: string;
  product_key: AiCreditPackProductKey;
  provider_transaction_id: string;
}

interface BindingRow {
  currency: string;
  environment: string;
  granted_amount: string;
  principal_id: string;
  product_id: string;
}

export type AiCreditPackReconciliationStatus =
  | { status: 'pending'; balance: null }
  | { status: 'verification_failed'; balance: null }
  | { status: 'grant_failed'; balance: null }
  | { status: 'granted'; balance: number };

@Injectable()
export class AiCreditPackReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly supportReferences: SupportReferenceService,
  ) {}

  async start(
    principal: AuthPrincipal,
    input: AiCreditPackReconciliationDto,
  ): Promise<{ id: string; supportReference: string }> {
    this.requireAccount(principal);
    return this.dataSource.transaction(async (manager) => {
      const rows = returningRows<{ id: string }>(await manager.query(
        `INSERT INTO economy.ai_credit_pack_purchase_reconciliations
           (account_id, product_key, provider_transaction_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, product_key, provider_transaction_id)
           DO UPDATE SET provider_transaction_id = EXCLUDED.provider_transaction_id
         RETURNING id`,
        [principal.id, input.productKey, input.transactionIdentifier],
      ));
      const reconciliation = rows[0];
      if (reconciliation === undefined) {
        throw new Error('AI Credit Pack reconciliation record was not created');
      }

      const existingReferences = await manager.query<readonly { code: string }[]>(
        `SELECT reference.code
         FROM support.support_reference_records record
         JOIN support.support_references reference
           ON reference.id = record.support_reference_id
         WHERE record.record_type = 'ai_credit_pack_purchase_reconciliation'
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
            type: 'ai_credit_pack_purchase_reconciliation',
            id: reconciliation.id,
          }],
        });
      return { id: reconciliation.id, supportReference };
    });
  }

  async getStatus(
    principal: AuthPrincipal,
    id: string,
  ): Promise<AiCreditPackReconciliationStatus> {
    this.requireAccount(principal);
    const reconciliations = await this.dataSource.query<readonly ReconciliationRow[]>(
      `SELECT id, account_id, product_key, provider_transaction_id
       FROM economy.ai_credit_pack_purchase_reconciliations
       WHERE id = $1 AND account_id = $2`,
      [id, principal.id],
    );
    const reconciliation = reconciliations[0];
    if (reconciliation === undefined) {
      throw new NotFoundException('AI Credit Pack reconciliation was not found');
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
      && candidate.currency === 'ai_credit');
    if (binding === undefined) {
      return { status: 'verification_failed', balance: null };
    }

    const grants = await this.dataSource.query<readonly { balance: string }[]>(
      `SELECT balance.balance
       FROM economy.ai_credit_ledger_entries entry
       JOIN economy.ai_credit_balances balance
         ON balance.principal_type = entry.principal_type
        AND balance.principal_id = entry.principal_id
       WHERE entry.principal_type = 'account'
         AND entry.principal_id = $1
         AND entry.source_key = $2
         AND entry.reason = 'pack_purchase'
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
      throw new ForbiddenException('A Registered Account is required for AI Credit Packs');
    }
  }
}
