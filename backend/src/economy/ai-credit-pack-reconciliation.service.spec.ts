import { ForbiddenException } from '@nestjs/common';

import { PrincipalType } from '../auth/entities';
import { AiCreditPackReconciliationService } from './ai-credit-pack-reconciliation.service';

describe('AiCreditPackReconciliationService', () => {
  const manager = { query: jest.fn() };
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn(
      (work: (value: typeof manager) => unknown) => Promise.resolve(work(manager)),
    ),
  };
  const supportReferences = { create: jest.fn() };
  const service = new AiCreditPackReconciliationService(
    dataSource as never,
    supportReferences as never,
  );
  const account = {
    id: 'ab8ee117-f10d-4b48-adae-36668984a282',
    tokenVersion: 1,
    type: PrincipalType.Account,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    manager.query
      .mockResolvedValueOnce([{ id: '86d57c4b-4329-4f8c-a37f-b26c3bdca382' }])
      .mockResolvedValueOnce([]);
    supportReferences.create.mockResolvedValue('SW-AI-CREDIT');
  });

  it('creates an idempotent account reconciliation with a Support Reference', async () => {
    await expect(service.start(account, {
      productKey: 'ai_credit_pack_5',
      transactionIdentifier: 'store-transaction-82',
    })).resolves.toEqual({
      id: '86d57c4b-4329-4f8c-a37f-b26c3bdca382',
      supportReference: 'SW-AI-CREDIT',
    });

    expect(manager.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ON CONFLICT (account_id, product_key, provider_transaction_id)'),
      [account.id, 'ai_credit_pack_5', 'store-transaction-82'],
    );
    expect(supportReferences.create).toHaveBeenCalledWith(manager, {
      principalType: 'account',
      principalId: account.id,
      records: [{
        type: 'ai_credit_pack_purchase_reconciliation',
        id: '86d57c4b-4329-4f8c-a37f-b26c3bdca382',
      }],
    });
  });

  it('rejects Guest reconciliation records', async () => {
    await expect(service.start({
      id: 'guest-id',
      tokenVersion: 1,
      type: PrincipalType.Guest,
    }, {
      productKey: 'ai_credit_pack_20',
      transactionIdentifier: 'store-transaction-guest',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stays pending until the exact Commerce Ledger binding exists', async () => {
    dataSource.query
      .mockResolvedValueOnce([reconciliationRow()])
      .mockResolvedValueOnce([]);

    await expect(service.getStatus(account, reconciliationRow().id)).resolves.toEqual({
      status: 'pending',
      balance: null,
    });
  });

  it('rejects a binding for a different closed product key', async () => {
    dataSource.query
      .mockResolvedValueOnce([reconciliationRow()])
      .mockResolvedValueOnce([{
        currency: 'ai_credit',
        environment: 'sandbox',
        granted_amount: '20',
        principal_id: account.id,
        product_id: 'com.avk.stitchwish.ai_credit_pack_20',
      }]);

    await expect(service.getStatus(account, reconciliationRow().id)).resolves.toEqual({
      status: 'verification_failed',
      balance: null,
    });
  });

  it('returns the current balance only after the matching AI Credit grant exists', async () => {
    dataSource.query
      .mockResolvedValueOnce([reconciliationRow()])
      .mockResolvedValueOnce([{
        currency: 'ai_credit',
        environment: 'sandbox',
        granted_amount: '5',
        principal_id: account.id,
        product_id: 'com.avk.stitchwish.ai_credit_pack_5',
      }])
      .mockResolvedValueOnce([{ balance: '9' }]);

    await expect(service.getStatus(account, reconciliationRow().id)).resolves.toEqual({
      status: 'granted',
      balance: 9,
    });
    expect(dataSource.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("entry.reason = 'pack_purchase'"),
      [account.id, 'commerce:sandbox:store-transaction-82', 5],
    );
  });

  it('reports grant failure when the exact binding has no matching ledger grant', async () => {
    dataSource.query
      .mockResolvedValueOnce([reconciliationRow()])
      .mockResolvedValueOnce([{
        currency: 'ai_credit',
        environment: 'sandbox',
        granted_amount: '5',
        principal_id: account.id,
        product_id: 'com.avk.stitchwish.ai_credit_pack_5',
      }])
      .mockResolvedValueOnce([]);

    await expect(service.getStatus(account, reconciliationRow().id)).resolves.toEqual({
      status: 'grant_failed',
      balance: null,
    });
  });

  function reconciliationRow() {
    return {
      id: '86d57c4b-4329-4f8c-a37f-b26c3bdca382',
      account_id: account.id,
      product_key: 'ai_credit_pack_5',
      provider_transaction_id: 'store-transaction-82',
    };
  }
});
