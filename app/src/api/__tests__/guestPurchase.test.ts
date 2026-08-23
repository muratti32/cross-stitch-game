import {
  createGuestPurchaseAttempt,
  fetchGuestPurchaseAttempt,
  mapGuestRevenueCatSubscriber,
} from '../guestPurchase';

// Mock the authenticated fetch wrapper so no network/identity is touched.
jest.mock('../apiFetch', () => ({
  apiFetch: jest.fn(),
}));

const { apiFetch } = require('../apiFetch');

const DISABLED_MESSAGE = 'Purchases are temporarily unavailable. Please try again later.';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('guest purchase client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('maps the RevenueCat subscriber when the Game Backend accepts it', async () => {
    apiFetch.mockResolvedValue(jsonResponse(201, {}));

    await expect(
      mapGuestRevenueCatSubscriber('$RCAnonymousID:abc'),
    ).resolves.toBeUndefined();
  });

  test('returns the created Guest Purchase Attempt with its Support Reference', async () => {
    const attempt = {
      id: 'attempt-1',
      status: 'created',
      productId: 'com.avk.stitchwish.coin_pack_300',
      supportReference: 'SW-TEST-0001',
      providerTransactionId: null,
    };
    apiFetch.mockResolvedValue(jsonResponse(201, attempt));

    await expect(
      createGuestPurchaseAttempt(attempt.productId, 'idem-1', '$RCAnonymousID:abc'),
    ).resolves.toEqual(attempt);
  });

  test('reports a disabled Guest commerce capability as a temporary outage, not a status code', async () => {
    apiFetch.mockResolvedValue(jsonResponse(403, { message: 'Guest commerce is disabled' }));

    await expect(
      createGuestPurchaseAttempt('com.avk.stitchwish.coin_pack_300', 'idem-2', '$RCAnonymousID:abc'),
    ).rejects.toThrow(DISABLED_MESSAGE);

    await expect(
      mapGuestRevenueCatSubscriber('$RCAnonymousID:abc'),
    ).rejects.toThrow(DISABLED_MESSAGE);
  });

  test('keeps other failures distinguishable from a capability rollback', async () => {
    apiFetch.mockResolvedValue(jsonResponse(503, {}));

    await expect(
      createGuestPurchaseAttempt('com.avk.stitchwish.coin_pack_300', 'idem-3', '$RCAnonymousID:abc'),
    ).rejects.toThrow('Guest purchase could not be prepared: 503');
  });

  test('surfaces a failed Guest Purchase Attempt lookup', async () => {
    apiFetch.mockResolvedValue(jsonResponse(404, {}));

    await expect(fetchGuestPurchaseAttempt('attempt-1')).rejects.toThrow(
      'Guest purchase status could not be read: 404',
    );
  });
});
