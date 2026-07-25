import { DataSource } from 'typeorm';

import { AccountStateService } from './account-state.service';

describe('AccountStateService', () => {
  let queryMock: jest.Mock;
  let dataSource: DataSource;
  let service: AccountStateService;

  beforeEach(() => {
    queryMock = jest.fn();
    dataSource = {
      query: queryMock,
    } as unknown as DataSource;
    service = new AccountStateService(dataSource);
  });

  it('queries database for account status and caches the result', async () => {
    queryMock.mockResolvedValueOnce([{ status: 'closing' }]);

    const status1 = await service.getAccountStatus('acc-1');
    expect(status1).toBe('closing');
    expect(queryMock).toHaveBeenCalledTimes(1);

    // Call again, should return cached status without querying
    const status2 = await service.getAccountStatus('acc-1');
    expect(status2).toBe('closing');
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('respects the 5-second TTL', async () => {
    const now = Date.now();
    const dateSpy = jest.spyOn(Date, 'now');

    // First call at time T
    dateSpy.mockReturnValue(now);
    queryMock.mockResolvedValueOnce([{ status: 'active' }]);
    const status1 = await service.getAccountStatus('acc-2');
    expect(status1).toBe('active');
    expect(queryMock).toHaveBeenCalledTimes(1);

    // Second call at T+4000 (within TTL)
    dateSpy.mockReturnValue(now + 4000);
    const status2 = await service.getAccountStatus('acc-2');
    expect(status2).toBe('active');
    expect(queryMock).toHaveBeenCalledTimes(1);

    // Third call at T+6000 (after TTL)
    dateSpy.mockReturnValue(now + 6000);
    queryMock.mockResolvedValueOnce([{ status: 'closed' }]);
    const status3 = await service.getAccountStatus('acc-2');
    expect(status3).toBe('closed');
    expect(queryMock).toHaveBeenCalledTimes(2);

    dateSpy.mockRestore();
  });

  it('forces a re-query when invalidated', async () => {
    queryMock.mockResolvedValueOnce([{ status: 'active' }]);
    const status1 = await service.getAccountStatus('acc-3');
    expect(status1).toBe('active');
    expect(queryMock).toHaveBeenCalledTimes(1);

    // Invalidate
    service.invalidate('acc-3');

    // Call again, should re-query
    queryMock.mockResolvedValueOnce([{ status: 'closing' }]);
    const status2 = await service.getAccountStatus('acc-3');
    expect(status2).toBe('closing');
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('returns null if account does not exist', async () => {
    queryMock.mockResolvedValueOnce([]);
    const status = await service.getAccountStatus('acc-unknown');
    expect(status).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('cleans up expired entries when map exceeds 10,000 entries', async () => {
    const now = Date.now();
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

    queryMock.mockResolvedValue([{ status: 'active' }]);

    // Insert 10,000 entries at T
    for (let i = 0; i < 10000; i++) {
      await service.getAccountStatus(`acc-bulk-${i}`);
    }

    // Advance time by 6000ms so they are expired
    dateSpy.mockReturnValue(now + 6000);

    // Add 10,001st entry. Triggers cleanup
    await service.getAccountStatus('acc-last');

    // Clear history to check re-query
    queryMock.mockClear();
    queryMock.mockResolvedValueOnce([{ status: 'active' }]);

    // Checking acc-bulk-0 should re-query database because it was dropped
    await service.getAccountStatus('acc-bulk-0');
    expect(queryMock).toHaveBeenCalledTimes(1);

    dateSpy.mockRestore();
  });
});
