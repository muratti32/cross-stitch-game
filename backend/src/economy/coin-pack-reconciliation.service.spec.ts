import { ForbiddenException } from '@nestjs/common';

import { PrincipalType } from '../auth/entities';
import { CoinPackReconciliationService } from './coin-pack-reconciliation.service';

describe('CoinPackReconciliationService', () => {
  const manager = { query: jest.fn() };
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn(
      (work: (value: typeof manager) => unknown) => Promise.resolve(work(manager)),
    ),
  };
  const supportReferences = { create: jest.fn() };
  const service = new CoinPackReconciliationService(
    dataSource as never,
    supportReferences as never,
  );
  const account = {
    id: 'ab8ee117-f10d-4b48-adae-36668984a200',
    tokenVersion: 1,
    type: PrincipalType.Account,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    manager.query
      .mockResolvedValueOnce([{ id: '86d57c4b-4329-4f8c-a37f-b26c3bdca304' }])
      .mockResolvedValueOnce([]);
    supportReferences.create.mockResolvedValue('SW-COIN-PACK');
  });

  it('creates an idempotent account reconciliation with a Support Reference', async () => {
    await expect(service.start(account, {
      productKey: 'coin_pack_300',
      transactionIdentifier: 'store-transaction-81',
    })).resolves.toEqual({
      id: '86d57c4b-4329-4f8c-a37f-b26c3bdca304',
      supportReference: 'SW-COIN-PACK',
    });

    expect(manager.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ON CONFLICT (account_id, product_key, provider_transaction_id)'),
      [account.id, 'coin_pack_300', 'store-transaction-81'],
    );
    expect(supportReferences.create).toHaveBeenCalledWith(manager, {
      principalType: 'account',
      principalId: account.id,
      records: [{
        type: 'coin_pack_purchase_reconciliation',
        id: '86d57c4b-4329-4f8c-a37f-b26c3bdca304',
      }],
    });
  });

  it('rejects Guest reconciliation records', async () => {
    await expect(service.start({
      id: 'guest-id',
      tokenVersion: 1,
      type: PrincipalType.Guest,
    }, {
      productKey: 'coin_pack_900',
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
        currency: 'coin',
        environment: 'sandbox',
        granted_amount: '900',
        principal_id: account.id,
        product_id: 'com.avk.stitchwish.coin_pack_900',
      }]);

    await expect(service.getStatus(account, reconciliationRow().id)).resolves.toEqual({
      status: 'verification_failed',
      balance: null,
    });
  });

  it('returns the current balance only after the matching Coin grant exists', async () => {
    dataSource.query
      .mockResolvedValueOnce([reconciliationRow()])
      .mockResolvedValueOnce([{
        currency: 'coin',
        environment: 'sandbox',
        granted_amount: '300',
        principal_id: account.id,
        product_id: 'com.avk.stitchwish.coin_pack_300',
      }])
      .mockResolvedValueOnce([{ balance: '420' }]);

    await expect(service.getStatus(account, reconciliationRow().id)).resolves.toEqual({
      status: 'granted',
      balance: 420,
    });
    expect(dataSource.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("entry.reason = 'coin_pack_purchase'"),
      [account.id, 'commerce:sandbox:store-transaction-81', 300],
    );
  });

  function reconciliationRow() {
    return {
      id: '86d57c4b-4329-4f8c-a37f-b26c3bdca304',
      account_id: account.id,
      product_key: 'coin_pack_300',
      provider_transaction_id: 'store-transaction-81',
    };
  }
});
