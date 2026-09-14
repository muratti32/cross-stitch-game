import {
  commitLocatorAttempt,
  LocatorInsufficientBalanceError,
  prepareLocatorAttempt,
  releaseLocatorAttempt,
  unlockPattern,
  fetchCoinBalance,
  fetchUnlockedPatternIds,
  InsufficientCoinError,
  unlockPriceForTier,
  openAdAttempt,
  claimAdReward,
  fetchAdAttemptState,
} from '../economy';

// Mock the authenticated fetch wrapper so no network/identity is touched.
jest.mock('../apiFetch', () => ({
  apiFetch: jest.fn(),
}));

const { apiFetch } = require('../apiFetch');

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('economy client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('unlockPriceForTier mirrors ADR-0011 fixed prices', () => {
    expect(unlockPriceForTier('small')).toBe(75);
    expect(unlockPriceForTier('medium')).toBe(150);
    expect(unlockPriceForTier('large')).toBe(300);
  });

  test('unlockPattern returns the spend result on success', async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(201, { patternId: 'p1', alreadyUnlocked: false, balance: 25 }),
    );

    const result = await unlockPattern('p1');

    expect(apiFetch).toHaveBeenCalledWith(
      '/v1/economy/unlocks',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual({ patternId: 'p1', alreadyUnlocked: false, balance: 25 });
  });

  test('unlockPattern maps 409 to InsufficientCoinError carrying price and balance', async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(409, { code: 'insufficient_balance', price: 300, balance: 50 }),
    );

    await expect(unlockPattern('p1')).rejects.toMatchObject({
      name: 'InsufficientCoinError',
      price: 300,
      balance: 50,
    });
    await expect(unlockPattern('p1')).rejects.toBeInstanceOf(InsufficientCoinError);
  });

  test('unlockPattern throws a generic error on other non-ok statuses', async () => {
    apiFetch.mockResolvedValue(jsonResponse(400, { code: 'pattern_free' }));

    await expect(unlockPattern('p1')).rejects.toThrow('Unlock failed: 400');
  });

  test('fetchCoinBalance returns the balance number', async () => {
    apiFetch.mockResolvedValue(jsonResponse(200, { balance: 120 }));
    await expect(fetchCoinBalance()).resolves.toBe(120);
  });

  test('fetchUnlockedPatternIds returns the id list', async () => {
    apiFetch.mockResolvedValue(jsonResponse(200, { patternIds: ['a', 'b'] }));
    await expect(fetchUnlockedPatternIds()).resolves.toEqual(['a', 'b']);
  });

  test('prepareLocatorAttempt sends the idempotency and session context', async () => {
    apiFetch.mockResolvedValue(jsonResponse(200, {
      attemptId: 'a', status: 'prepared', price: 1, balance: 4,
      expiresAt: '2026-09-14T10:01:00.000Z', targetCellIndex: null,
    }));
    await expect(prepareLocatorAttempt({
      attemptId: 'a', sessionId: 's', patternId: 'p', colorIndex: 0, dmcCode: '310',
    })).resolves.toMatchObject({ status: 'prepared', price: 1 });
    expect(apiFetch).toHaveBeenCalledWith('/v1/economy/locator-attempts/prepare', expect.objectContaining({ method: 'POST' }));
  });

  test('locator commit/release remain idempotent by using the same attempt id', async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse(200, { attemptId: 'a', status: 'committed', price: 1, balance: 3, expiresAt: 'x', targetCellIndex: 4 }))
      .mockResolvedValueOnce(jsonResponse(200, { attemptId: 'a', status: 'released', price: 1, balance: 4, expiresAt: 'x', targetCellIndex: null }));
    await commitLocatorAttempt('a', { targetCellIndex: 4 });
    await releaseLocatorAttempt('a');
    expect(apiFetch.mock.calls[0][0]).toBe('/v1/economy/locator-attempts/a/commit');
    expect(apiFetch.mock.calls[1][0]).toBe('/v1/economy/locator-attempts/a/release');
  });

  test('locator prepare exposes insufficient balance without moving the viewport', async () => {
    apiFetch.mockResolvedValue(jsonResponse(409, { code: 'insufficient_balance', price: 1, balance: 0 }));
    await expect(prepareLocatorAttempt({
      attemptId: 'a', sessionId: 's', patternId: 'p', colorIndex: 0, dmcCode: '310',
    })).rejects.toBeInstanceOf(LocatorInsufficientBalanceError);
  });

  test('openAdAttempt returns nonce, expiresAt and ssvActive flag', async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(201, {
        nonce: 'test-nonce-123',
        expiresAt: '2026-09-14T12:00:00.000Z',
        ssvActive: true,
      }),
    );
    const result = await openAdAttempt();
    expect(apiFetch).toHaveBeenCalledWith(
      '/v1/economy/ad-attempts',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual({
      nonce: 'test-nonce-123',
      expiresAt: '2026-09-14T12:00:00.000Z',
      ssvActive: true,
    });
  });

  test('claimAdReward posts nonce and returns grant result', async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(200, {
        granted: false,
        amount: 0,
        balance: 50,
        adsCompleted: 1,
        coinsConsumed: 10,
        replayed: false,
      }),
    );
    const result = await claimAdReward('test-nonce-123');
    expect(apiFetch).toHaveBeenCalledWith(
      '/v1/economy/ad-attempts/claim',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ nonce: 'test-nonce-123' }),
      }),
    );
    expect(result).toEqual({
      granted: false,
      amount: 0,
      balance: 50,
      adsCompleted: 1,
      coinsConsumed: 10,
      replayed: false,
    });
  });

  test('fetchAdAttemptState reads the nonce-specific verification state', async () => {
    apiFetch.mockResolvedValue(jsonResponse(200, {
      state: 'pending',
      expiresAt: '2026-09-14T12:05:00.000Z',
    }));
    await expect(fetchAdAttemptState('nonce/unsafe')).resolves.toEqual({
      state: 'pending',
      expiresAt: '2026-09-14T12:05:00.000Z',
    });
    expect(apiFetch).toHaveBeenCalledWith('/v1/economy/ad-attempts/nonce%2Funsafe');
  });
});
