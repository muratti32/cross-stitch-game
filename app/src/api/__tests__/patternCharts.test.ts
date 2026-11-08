import { apiFetch } from '../apiFetch';
import {
  fetchPatternChartAccess,
  isRemovedChartError,
  mapPatternChartError,
  PatternChartError,
  purchasePatternChart,
  requestPatternChartArtifactGrant,
} from '../patternCharts';

jest.mock('../apiFetch', () => ({ apiFetch: jest.fn() }));
jest.mock('../../analytics/gameplayEvents', () => ({ captureGameplayEvent: jest.fn() }));
const mockedFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

function respond(status: number, body: unknown): void {
  mockedFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe('mapPatternChartError', () => {
  it.each([
    [403, { code: 'account_required' }, 'account_required'],
    [403, { code: 'unlock_required', price: 150 }, 'unlock_required'],
    [403, { code: 'pattern_chart_required' }, 'chart_required'],
    [404, null, 'not_found'],
    [410, { code: 'pattern_removed' }, 'removed'],
    [410, { code: 'pattern_unavailable' }, 'unavailable'],
    [410, null, 'unavailable'],
    [409, { code: 'pattern_chart_price_changed', price: 60 }, 'price_changed'],
    [409, { code: 'insufficient_balance', price: 40, balance: 10 }, 'insufficient_balance'],
    [500, { code: 'boom' }, 'other'],
  ] as const)('%i %j -> %s', (status, body, kind) => {
    expect(mapPatternChartError(status, body).kind).toBe(kind);
  });

  it('carries price and balance from the body', () => {
    const err = mapPatternChartError(409, { code: 'insufficient_balance', price: 40, balance: 10 });
    expect([err.price, err.balance, err.status, err.reason]).toEqual([40, 10, 409, 'insufficient_balance']);
  });

  it('ignores non-integer price fields', () => {
    expect(mapPatternChartError(409, { code: 'pattern_chart_price_changed', price: 'x' }).price).toBeNull();
  });
});

describe('pattern chart requests', () => {
  beforeEach(() => mockedFetch.mockReset());

  it('reads access: entitled, purchasable, and ineligible on 404', async () => {
    respond(200, { patternId: 'p', entitled: true, price: 20, status: 'available' });
    await expect(fetchPatternChartAccess('p')).resolves.toEqual({ status: 'entitled', price: 20, availability: 'available' });
    respond(200, { patternId: 'p', entitled: false, price: 40, status: 'withdrawn' });
    await expect(fetchPatternChartAccess('p')).resolves.toEqual({ status: 'purchasable', price: 40, availability: 'withdrawn' });
    respond(404, { code: 'not_found' });
    await expect(fetchPatternChartAccess('p')).resolves.toEqual({ status: 'ineligible' });
  });

  it('reports a Safety Removal as removed, from either the status field or a 410', async () => {
    respond(200, { patternId: 'p', entitled: true, price: 20, status: 'removed' });
    await expect(fetchPatternChartAccess('p')).resolves.toEqual({ status: 'removed' });
    respond(410, { code: 'pattern_removed' });
    await expect(fetchPatternChartAccess('p')).resolves.toEqual({ status: 'removed' });
  });

  it('rejects a response without a known pattern status', async () => {
    respond(200, { patternId: 'p', entitled: true, price: 20 });
    await expect(fetchPatternChartAccess('p')).rejects.toBeInstanceOf(PatternChartError);
  });

  it('throws a typed error on a guest 403 and on a malformed 200', async () => {
    respond(403, { code: 'account_required' });
    await expect(fetchPatternChartAccess('p')).rejects.toMatchObject({ kind: 'account_required' });
    respond(200, { entitled: 'yes' });
    await expect(fetchPatternChartAccess('p')).rejects.toBeInstanceOf(PatternChartError);
  });

  it('posts the expected price and returns the purchase', async () => {
    respond(201, { patternId: 'p', alreadyEntitled: false, price: 40, tier: 'medium', balance: 60 });
    await expect(purchasePatternChart('p', 40)).resolves.toEqual({ patternId: 'p', alreadyEntitled: false, price: 40, tier: 'medium', balance: 60 });
    const [path, init] = mockedFetch.mock.calls[0];
    expect(path).toBe('/v1/economy/pattern-charts');
    expect(JSON.parse(String(init?.body))).toEqual({ patternId: 'p', expectedPrice: 40 });
  });

  it.each([
    ['no tier', { patternId: 'p', alreadyEntitled: false, price: 40, balance: 60 }],
    ['an unknown tier', { patternId: 'p', alreadyEntitled: false, price: 40, tier: 'huge', balance: 60 }],
    ['a fractional balance', { patternId: 'p', alreadyEntitled: false, price: 40, tier: 'medium', balance: 1.5 }],
  ])('rejects a purchase response with %s', async (_name, body) => {
    respond(201, body);
    await expect(purchasePatternChart('p', 40)).rejects.toMatchObject({ reason: 'invalid_pattern_chart_response' });
  });

  it.each([
    ['no patternId', { artifact: { byteLength: 3, checksum: 'abc', schemaVersion: 1 }, grant: { url: '/u', expiresAt: 'z' } }],
    ['no schemaVersion', { patternId: 'p', artifact: { byteLength: 3, checksum: 'abc' }, grant: { url: '/u', expiresAt: 'z' } }],
    ['no expiresAt', { patternId: 'p', artifact: { byteLength: 3, checksum: 'abc', schemaVersion: 1 }, grant: { url: '/u' } }],
  ])('rejects an artifact grant with %s', async (_name, body) => {
    respond(201, body);
    await expect(requestPatternChartArtifactGrant('p')).rejects.toBeInstanceOf(PatternChartError);
  });

  it('classifies a removed chart error', () => {
    expect(isRemovedChartError(mapPatternChartError(410, { code: 'pattern_removed' }))).toBe(true);
    expect(isRemovedChartError(mapPatternChartError(410, { code: 'pattern_unavailable' }))).toBe(false);
    expect(isRemovedChartError(new Error('x'))).toBe(false);
  });

  it('surfaces price change and insufficient balance from a purchase', async () => {
    respond(409, { code: 'pattern_chart_price_changed', price: 60 });
    await expect(purchasePatternChart('p', 40)).rejects.toMatchObject({ kind: 'price_changed', price: 60 });
    respond(409, { code: 'insufficient_balance', price: 40, balance: 5 });
    await expect(purchasePatternChart('p', 40)).rejects.toMatchObject({ kind: 'insufficient_balance', price: 40, balance: 5 });
  });

  it('requests an artifact grant and maps removed patterns', async () => {
    respond(201, { patternId: 'p', artifact: { byteLength: 3, checksum: 'abc', schemaVersion: 1 }, grant: { url: '/v1/artifacts/p?x=1', expiresAt: 'z' } });
    await expect(requestPatternChartArtifactGrant('p')).resolves.toMatchObject({ grant: { url: '/v1/artifacts/p?x=1' } });
    expect(mockedFetch.mock.calls[0][0]).toBe('/v1/economy/pattern-charts/p/artifact-grant');
    respond(410, { code: 'pattern_removed' });
    await expect(requestPatternChartArtifactGrant('p')).rejects.toMatchObject({ kind: 'removed' });
  });
});
