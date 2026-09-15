import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

import { LocatorPriceAdminService } from './locator-price-admin.service';

describe('LocatorPriceAdminService', () => {
  const operatorId = '11111111-1111-4111-8111-111111111111';
  const row = (price: number) => [{ price_coin: price, updated_at: new Date('2026-09-14T10:00:00Z'), updated_by_operator_id: null }];

  function makeService(query: jest.Mock) {
    const manager = { query };
    const dataSource = {
      manager,
      transaction: jest.fn((callback: (tx: typeof manager) => unknown) => Promise.resolve(callback(manager))),
    };
    const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new LocatorPriceAdminService(dataSource as never, auditLog);
    return { service, auditLog, manager };
  }

  it('changes the price under a row lock and audits previous and new amounts', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(row(1))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...row(5)[0], updated_by_operator_id: operatorId }]);
    const { service, auditLog, manager } = makeService(query);

    await expect(service.update(operatorId, 5, 'req-1')).resolves.toMatchObject({
      price: 5, minPrice: 1, maxPrice: 10, updatedByOperatorId: operatorId,
    });
    const calls = query.mock.calls as unknown[][];
    expect(String(calls[0][0])).toContain('FOR UPDATE');
    expect(calls[1][1]).toEqual([5, operatorId]);
    expect(auditLog.record).toHaveBeenCalledWith(manager, expect.objectContaining({
      action: 'economy.locator_price.update',
      before: { price: 1 },
      after: { price: 5 },
      operatorAccountId: operatorId,
      requestId: 'req-1',
    }));
  });

  it('does not write or audit when the price is unchanged', async () => {
    const query = jest.fn().mockResolvedValueOnce(row(2));
    const { service, auditLog } = makeService(query);

    await expect(service.update(operatorId, 2, null)).resolves.toMatchObject({ price: 2 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it.each([0, 11, 1.5])('rejects out-of-range price %p before touching the database', async (price) => {
    const query = jest.fn();
    const { service } = makeService(query);
    await expect(service.update(operatorId, price, null)).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed when the setting row is missing', async () => {
    const { service } = makeService(jest.fn().mockResolvedValueOnce([]));
    await expect(service.get()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
