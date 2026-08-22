import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { returningRows } from '../database/query-results';
import {
  CommerceCurrency,
  resolveCommerceProduct,
} from './commerce.constants';
import type { CommerceOwner } from './commerce-owner';
import { CoinLedgerReason, AiCreditLedgerReason } from './entities';

export interface CommercePurchaseResult {
  outcome: 'granted' | 'replayed_same_account' | 'rejected_other_account' | 'unknown_product';
  currency: CommerceCurrency | null;
  amount: number; // 0 unless outcome === 'granted' (or replayed_same_account, where it's the original amount)
  balance: number | null; // resulting balance in the relevant ledger, null when outcome is unknown_product/rejected_other_account
}

export interface CommerceReversalResult {
  applied: boolean; // true only the first time a given transaction's reversal is processed
  currency: CommerceCurrency | null;
  amount: number; // the amount withdrawn (0 if not applied)
  balance: number | null;
}

interface ClaimRow {
  id: string;
}

interface BindingRow {
  environment: string;
  provider_transaction_id: string;
  principal_type: string;
  principal_id: string;
  product_id: string;
  currency: string;
  granted_amount: string;
  reversed_at: string | null;
  created_at: string;
}

interface BalanceRow {
  balance: string;
}

@Injectable()
export class CommerceLedgerRepository {
  constructor(private readonly dataSource: DataSource) {}

  async processPurchase(params: {
    environment: 'sandbox' | 'production';
    providerTransactionId: string;
    accountId?: string;
    owner?: CommerceOwner;
    productId: string;
  }): Promise<CommercePurchaseResult> {
    const product = resolveCommerceProduct(params.productId);
    if (!product) {
      return {
        outcome: 'unknown_product',
        currency: null,
        amount: 0,
        balance: null,
      };
    }

    const { currency, amount } = product;
    const owner = params.owner ?? (
      params.accountId === undefined
        ? null
        : { type: 'account' as const, accountId: params.accountId }
    );
    if (owner === null) throw new Error('Commerce purchase owner is required');
    const principalType = owner.type;
    const principalId = owner.type === 'account' ? owner.accountId : owner.guestInstallationId;

    return this.dataSource.transaction(async (manager) => {
      // 1. Claim the binding
      const bindingClaim = returningRows<BindingRow>(
        await manager.query(
          `INSERT INTO economy.commerce_transaction_bindings
             (environment, provider_transaction_id, principal_type, principal_id, product_id, currency, granted_amount, account_id, guest_installation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT ON CONSTRAINT "PK_commerce_transaction_bindings" DO NOTHING
           RETURNING *`,
          [
            params.environment,
            params.providerTransactionId,
            principalType,
            principalId,
            params.productId,
            currency,
            amount,
            owner.type === 'account' ? principalId : null,
            owner.type === 'guest' ? principalId : null,
          ],
        ),
      );

      if (bindingClaim.length > 0) {
        // Success: First time processing this purchase
        let newBalance = 0;
        if (currency === 'coin') {
          // Write coin ledger entry and update coin balance
          const sourceKey = `commerce:${params.environment}:${params.providerTransactionId}`;
          await manager.query(
            `INSERT INTO economy.coin_ledger_entries
               (principal_type, principal_id, amount, reason, source_key, granted, metadata)
             VALUES ($1, $2, $3, $4, $5, true, NULL)
             ON CONFLICT ON CONSTRAINT "UQ_coin_ledger_entries_source_key" DO NOTHING`,
            [principalType, principalId, amount, CoinLedgerReason.CoinPackPurchase, sourceKey],
          );

          const balanceRows = returningRows<BalanceRow>(
            await manager.query(
              `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
               VALUES ($1, $2, $3)
               ON CONFLICT ON CONSTRAINT "PK_coin_balances"
                 DO UPDATE SET balance = economy.coin_balances.balance + EXCLUDED.balance,
                               updated_at = now()
               RETURNING balance`,
              [principalType, principalId, amount],
            ),
          );
          newBalance = Number(balanceRows[0].balance);
        } else if (currency === 'ai_credit') {
          // Write AI credit ledger entry and update AI credit balance
          const sourceKey = `commerce:${params.environment}:${params.providerTransactionId}`;
          await manager.query(
            `INSERT INTO economy.ai_credit_ledger_entries
               (principal_type, principal_id, amount, reason, source_key, granted, metadata)
             VALUES ($1, $2, $3, $4, $5, true, NULL)
             ON CONFLICT ON CONSTRAINT "UQ_ai_credit_ledger_entries_source_key" DO NOTHING`,
            [principalType, principalId, amount, AiCreditLedgerReason.PackPurchase, sourceKey],
          );

          const balanceRows = returningRows<BalanceRow>(
            await manager.query(
              `INSERT INTO economy.ai_credit_balances (principal_type, principal_id, balance)
               VALUES ($1, $2, $3)
               ON CONFLICT ON CONSTRAINT "PK_ai_credit_balances"
                 DO UPDATE SET balance = economy.ai_credit_balances.balance + EXCLUDED.balance,
                               updated_at = now()
               RETURNING balance`,
              [principalType, principalId, amount],
            ),
          );
          newBalance = Number(balanceRows[0].balance);
        }

        return {
          outcome: 'granted',
          currency,
          amount,
          balance: newBalance,
        };
      }

      // Conflict: Binding already exists
      const existingRows = await manager.query<readonly BindingRow[]>(
        `SELECT * FROM economy.commerce_transaction_bindings
         WHERE environment = $1 AND provider_transaction_id = $2`,
        [params.environment, params.providerTransactionId],
      );
      const existing = existingRows[0];
      if (!existing) {
        throw new Error('Inconsistent database state: binding claim failed but no row found');
      }

      if (existing.principal_id !== principalId || existing.principal_type !== principalType) {
        return {
          outcome: 'rejected_other_account',
          currency: existing.currency as CommerceCurrency,
          amount: 0,
          balance: null,
        };
      }

      // Replay same account
      const currentBalance = await this.readBalance(
        manager,
        principalType,
        principalId,
        existing.currency === 'coin' ? 'coin_balances' : 'ai_credit_balances',
      );

      return {
        outcome: 'replayed_same_account',
        currency: existing.currency as CommerceCurrency,
        amount: Number(existing.granted_amount),
        balance: currentBalance,
      };
    });
  }

  async processReversal(params: {
    environment: 'sandbox' | 'production';
    providerTransactionId: string;
  }): Promise<CommerceReversalResult> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Lock binding row
      const bindingRows = await manager.query<readonly BindingRow[]>(
        `SELECT * FROM economy.commerce_transaction_bindings
         WHERE environment = $1 AND provider_transaction_id = $2
         FOR UPDATE`,
        [params.environment, params.providerTransactionId],
      );
      const binding = bindingRows[0];
      if (!binding) {
        return {
          applied: false,
          currency: null,
          amount: 0,
          balance: null,
        };
      }

      const currency = binding.currency as CommerceCurrency;
      const amountToWithdraw = -Number(binding.granted_amount);
      const sourceKey = `reversal:${params.environment}:${params.providerTransactionId}`;

      // 2. Claim the reversal in the ledger
      let claim: readonly ClaimRow[];
      if (currency === 'coin') {
        claim = returningRows<ClaimRow>(
          await manager.query(
            `INSERT INTO economy.coin_ledger_entries
               (principal_type, principal_id, amount, reason, source_key, granted, metadata)
             VALUES ($1, $2, $3, $4, $5, true, NULL)
             ON CONFLICT ON CONSTRAINT "UQ_coin_ledger_entries_source_key" DO NOTHING
             RETURNING id`,
            [binding.principal_type, binding.principal_id, amountToWithdraw, CoinLedgerReason.CommerceReversal, sourceKey],
          ),
        );
      } else {
        claim = returningRows<ClaimRow>(
          await manager.query(
            `INSERT INTO economy.ai_credit_ledger_entries
               (principal_type, principal_id, amount, reason, source_key, granted, metadata)
             VALUES ($1, $2, $3, $4, $5, true, NULL)
             ON CONFLICT ON CONSTRAINT "UQ_ai_credit_ledger_entries_source_key" DO NOTHING
             RETURNING id`,
            [binding.principal_type, binding.principal_id, amountToWithdraw, AiCreditLedgerReason.CommerceReversal, sourceKey],
          ),
        );
      }

      if (claim.length === 0) {
        // Already reversed
        const currentBalance = await this.readBalance(
          manager,
          binding.principal_type,
          binding.principal_id,
          currency === 'coin' ? 'coin_balances' : 'ai_credit_balances',
        );
        return {
          applied: false,
          currency,
          amount: 0,
          balance: currentBalance,
        };
      }

      // 3. Update the balance and update reversed_at
      let newBalance = 0;
      if (currency === 'coin') {
        const balanceRows = returningRows<BalanceRow>(
          await manager.query(
            `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
             VALUES ($1, $2, $3)
             ON CONFLICT ON CONSTRAINT "PK_coin_balances"
               DO UPDATE SET balance = economy.coin_balances.balance + EXCLUDED.balance,
                             updated_at = now()
             RETURNING balance`,
            [binding.principal_type, binding.principal_id, amountToWithdraw],
          ),
        );
        newBalance = Number(balanceRows[0].balance);
      } else {
        const balanceRows = returningRows<BalanceRow>(
          await manager.query(
            `INSERT INTO economy.ai_credit_balances (principal_type, principal_id, balance)
             VALUES ($1, $2, $3)
             ON CONFLICT ON CONSTRAINT "PK_ai_credit_balances"
               DO UPDATE SET balance = economy.ai_credit_balances.balance + EXCLUDED.balance,
                             updated_at = now()
             RETURNING balance`,
            [binding.principal_type, binding.principal_id, amountToWithdraw],
          ),
        );
        newBalance = Number(balanceRows[0].balance);
      }

      await manager.query(
        `UPDATE economy.commerce_transaction_bindings
         SET reversed_at = now()
         WHERE environment = $1 AND provider_transaction_id = $2`,
        [params.environment, params.providerTransactionId],
      );

      return {
        applied: true,
        currency,
        amount: Number(binding.granted_amount),
        balance: newBalance,
      };
    });
  }

  async getAiCreditBalance(principal: { type: 'account' | 'guest'; id: string }): Promise<number> {
    return this.readBalance(
      this.dataSource.manager,
      principal.type,
      principal.id,
      'ai_credit_balances',
    );
  }

  private async readBalance(
    manager: EntityManager,
    principalType: string,
    principalId: string,
    table: 'coin_balances' | 'ai_credit_balances',
  ): Promise<number> {
    const rows = await manager.query<readonly BalanceRow[]>(
      `SELECT balance
       FROM economy.${table}
       WHERE principal_type = $1 AND principal_id = $2`,
      [principalType, principalId],
    );
    return rows.length === 0 ? 0 : Number(rows[0].balance);
  }
}
