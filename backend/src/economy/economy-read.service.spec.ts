import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { EconomyReadService } from './economy-read.service';

describe('EconomyReadService.getBalance', () => {
  const principal: AuthPrincipal = {
    id: '11111111-1111-4111-8111-111111111111',
    type: PrincipalType.Guest,
    tokenVersion: 1,
  };

  function makeService(query: jest.Mock) {
    const ledger = { getBalance: jest.fn().mockResolvedValue(12) };
    return new EconomyReadService(ledger as never, {} as never, { manager: { query } } as never);
  }

  it('serves the current Locator Price with the balance', async () => {
    const query = jest.fn().mockResolvedValue([{ price_coin: 3, updated_at: new Date(), updated_by_operator_id: null }]);
    await expect(makeService(query).getBalance(principal)).resolves.toEqual({ balance: 12, locatorPrice: 3 });
  });

  it.each([
    ['a missing setting row', () => Promise.resolve([])],
    ['a database failure', () => Promise.reject(new Error('relation "economy.locator_price_setting" does not exist'))],
  ])('keeps serving the balance with a null price on %s', async (_label, result) => {
    const query = jest.fn().mockImplementation(result);
    await expect(makeService(query).getBalance(principal)).resolves.toEqual({ balance: 12, locatorPrice: null });
  });
});
