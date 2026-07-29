import { ForbiddenException } from '@nestjs/common';

import { PrincipalType } from '../auth/entities';
import { MembershipService } from './membership.service';

describe('MembershipService purchase reconciliation', () => {
  const manager = { query: jest.fn() };
  const dataSource = {
    transaction: jest.fn(
      (work: (value: typeof manager) => unknown) => Promise.resolve(work(manager)),
    ),
  };
  const supportReferences = { create: jest.fn() };
  const service = new MembershipService(
    {} as never,
    {} as never,
    dataSource as never,
    supportReferences as never,
  );

  beforeEach(() => {
    manager.query.mockResolvedValue([{ id: '86d57c4b-4329-4f8c-a37f-b26c3bdca304' }]);
    supportReferences.create.mockResolvedValue('SW-ABCD-EFGH');
  });

  it('creates an account-scoped Support Reference for a Premium purchase reconciliation', async () => {
    await expect(service.startReconciliation({
      id: 'ab8ee117-f10d-4b48-adae-36668984a200',
      tokenVersion: 1,
      type: PrincipalType.Account,
    }, {
      operation: 'purchase',
      productKey: 'premium_annual',
    })).resolves.toEqual({ supportReference: 'SW-ABCD-EFGH' });

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('premium_purchase_reconciliations'),
      [
        'ab8ee117-f10d-4b48-adae-36668984a200',
        'purchase',
        'premium_annual',
      ],
    );
    expect(supportReferences.create).toHaveBeenCalledWith(manager, {
      principalType: 'account',
      principalId: 'ab8ee117-f10d-4b48-adae-36668984a200',
      records: [{
        type: 'premium_purchase_reconciliation',
        id: '86d57c4b-4329-4f8c-a37f-b26c3bdca304',
      }],
    });
  });

  it('rejects Guest reconciliation records', async () => {
    await expect(service.startReconciliation({
      id: 'guest-id',
      tokenVersion: 1,
      type: PrincipalType.Guest,
    }, {
      operation: 'restore',
      productKey: null,
    })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
