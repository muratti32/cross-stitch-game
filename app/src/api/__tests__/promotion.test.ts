import {
  cancelPromotion,
  commitPromotion,
  drainLike,
  drainSession,
  fetchPromotionPreview,
  isPromotionErrorCode,
  lockPromotion,
  PromotionApiError,
  stagePromotionPackage,
  type PromotionManifest,
  type PromotionPreviewResponse,
} from '../promotion';

jest.mock('../apiFetch', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = require('../apiFetch') as { apiFetch: jest.Mock };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function unreadableResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  } as unknown as Response;
}

const MANIFEST: PromotionManifest = { progress: {}, completions: {}, pendingRewards: {}, likes: {} };

function preview(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    guestId: 'guest-1',
    accountId: 'account-1',
    promotionMode: 'economy',
    manifestChecksum: 'abc',
    guestLedgerBalance: 120,
    guestUnlockCount: 2,
    pendingAdAttemptCount: 1,
    validatedPendingRewards: ['first_completion:guest:guest-1:p1'],
    rejectedPendingRewards: { 'daily_task:guest:guest-1:2026-01-01:cells_100': 'implausible_evidence' },
    dispositions: {
      coinBalance: 'transfer',
      pendingRewards: 'validate',
      progress: 'transfer',
      completions: 'transfer',
      likes: 'transfer',
    },
    expiry: '2026-01-01T00:00:00.000Z',
    signature: 'sig',
    paidCommerce: 'none',
    ...overrides,
  };
}

async function failureOf(promise: Promise<unknown>): Promise<PromotionApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PromotionApiError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

beforeEach(() => apiFetch.mockReset());

describe('promotion API client', () => {
  test('parses a preview with the new unlock and ad-attempt counts', async () => {
    apiFetch.mockResolvedValue(jsonResponse(200, preview()));

    const result = await fetchPromotionPreview({
      guestId: 'guest-1',
      guestCredential: 'secret',
      manifest: MANIFEST,
      manifestChecksum: 'abc',
    });

    expect(result.guestUnlockCount).toBe(2);
    expect(result.pendingAdAttemptCount).toBe(1);
    expect(result.promotionMode).toBe('economy');
  });

  test('forwards the preview to lock and commit exactly as the server issued it', async () => {
    const issued = preview({ serverOnlyField: 'kept' });
    apiFetch.mockResolvedValueOnce(jsonResponse(200, issued));
    const parsed = await fetchPromotionPreview({
      guestId: 'guest-1',
      guestCredential: 'secret',
      manifest: MANIFEST,
      manifestChecksum: 'abc',
    });
    apiFetch.mockResolvedValueOnce(jsonResponse(200, { lockToken: 'lock-1', expiry: 'e' }));
    apiFetch.mockResolvedValueOnce(
      jsonResponse(200, { status: 'committed', promotionMode: 'economy', replayed: false }),
    );

    await lockPromotion(parsed, 'sig');
    await commitPromotion(parsed, 'sig');

    for (const call of apiFetch.mock.calls.slice(1)) {
      expect(JSON.parse((call[1] as { body: string }).body)).toEqual({ previewData: issued, signature: 'sig' });
    }
  });

  test.each([
    ['a missing unlock count', preview({ guestUnlockCount: undefined })],
    ['a negative coin balance', preview({ guestLedgerBalance: -1 })],
    ['an unknown mode', preview({ promotionMode: 'both' })],
    ['a non-list of validated rewards', preview({ validatedPendingRewards: 'x' })],
    ['a non-object body', 'nope'],
  ])('rejects a preview with %s as invalid_response', async (_name, body) => {
    apiFetch.mockResolvedValue(jsonResponse(200, body));

    const error = await failureOf(
      fetchPromotionPreview({ guestId: 'g', guestCredential: 's', manifest: MANIFEST, manifestChecksum: 'c' }),
    );

    expect(error.code).toBe('invalid_response');
    expect(error.status).toBe(200);
  });

  test.each([
    ['preview', 409, 'guest_consumed'],
    ['preview', 401, null],
    ['lock', 400, 'preview_expired'],
    ['lock', 400, 'preview_invalid'],
    ['stage', 409, 'promotion_lock_expired'],
    ['commit', 409, 'promotion_stale'],
    ['commit', 400, 'preview_expired'],
  ])('%s with status %i surfaces code %s as a typed error', async (endpoint, status, code) => {
    apiFetch.mockResolvedValue(
      jsonResponse(status, code === null ? { statusCode: status, message: 'English prose' } : { statusCode: status, message: 'English prose', code }),
    );
    const issued = parseable();

    const call = {
      preview: () => fetchPromotionPreview({ guestId: 'g', guestCredential: 's', manifest: MANIFEST, manifestChecksum: 'c' }),
      lock: () => lockPromotion(issued, 'sig'),
      stage: () =>
        stagePromotionPackage({
          guestId: 'g',
          lockToken: 'l',
          manifestChecksum: 'c',
          packageData: { manifest: MANIFEST, sessions: [] },
          checksum: 'c',
        }),
      commit: () => commitPromotion(issued, 'sig'),
    }[endpoint as 'preview' | 'lock' | 'stage' | 'commit'];

    const error = await failureOf(call());

    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.reason).toBe(code);
  });

  test('knows exactly the contract codes', () => {
    expect(isPromotionErrorCode('promotion_stale')).toBe(true);
    expect(isPromotionErrorCode('guest_consumed')).toBe(true);
    expect(isPromotionErrorCode('something_else')).toBe(false);
    expect(isPromotionErrorCode(null)).toBe(false);
  });

  test('keeps a status-only error when the error body is unreadable', async () => {
    apiFetch.mockResolvedValue(unreadableResponse(502));

    const error = await failureOf(cancelPromotion('guest-1'));

    expect(error.status).toBe(502);
    expect(error.code).toBeNull();
  });

  test('parses a commit response and its replayed flag', async () => {
    apiFetch.mockResolvedValue(jsonResponse(200, { status: 'committed', promotionMode: 'data-only', replayed: true }));

    await expect(commitPromotion(parseable(), 'sig')).resolves.toEqual({
      status: 'committed',
      promotionMode: 'data-only',
      replayed: true,
    });
  });

  test('rejects a commit response without a replayed flag', async () => {
    apiFetch.mockResolvedValue(jsonResponse(200, { status: 'committed', promotionMode: 'economy' }));

    const error = await failureOf(commitPromotion(parseable(), 'sig'));

    expect(error.code).toBe('invalid_response');
  });

  test('drain calls resolve without reading a response body', async () => {
    apiFetch.mockResolvedValue(unreadableResponse(200));

    await expect(drainLike('guest-1', 'p1')).resolves.toBeUndefined();
    await expect(cancelPromotion('guest-1')).resolves.toBeUndefined();
  });

  test('a session drain returns the surviving session', async () => {
    const body = {
      status: 'merged',
      accountSessionId: 'a1',
      revision: 9,
      packedBitmapBase64: 'Bw==',
      terminalCompleted: false,
      isLocked: false,
      role: 'replay',
    };
    apiFetch.mockResolvedValue(jsonResponse(200, body));

    await expect(drainSession('guest-1', 'p1', 's1')).resolves.toEqual(body);
  });

  test('a drain for a session the server no longer has carries nulls', async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(200, {
        status: 'acknowledged',
        accountSessionId: null,
        revision: 0,
        packedBitmapBase64: null,
        terminalCompleted: false,
        isLocked: false,
        detail: 'session_not_found',
      }),
    );

    await expect(drainSession('g', 'p', 's')).resolves.toMatchObject({ accountSessionId: null, detail: 'session_not_found' });
  });

  test.each([
    ['an unknown status', { status: 'done' }],
    ['a missing revision', { revision: undefined }],
    ['a missing lock flag', { isLocked: undefined }],
    ['a non-text bitmap', { packedBitmapBase64: 7 }],
  ])('a session drain rejects %s', async (_label, overrides) => {
    apiFetch.mockResolvedValue(
      jsonResponse(200, {
        status: 'transferred',
        accountSessionId: 'a1',
        revision: 1,
        packedBitmapBase64: '',
        terminalCompleted: false,
        isLocked: false,
        ...overrides,
      }),
    );

    expect((await failureOf(drainSession('g', 'p', 's'))).code).toBe('invalid_response');
  });

  test('a failed drain throws the typed error', async () => {
    apiFetch.mockResolvedValue(jsonResponse(409, { code: 'guest_consumed' }));

    const error = await failureOf(drainSession('g', 'p', 's'));

    expect(error.code).toBe('guest_consumed');
  });
});

function parseable(): PromotionPreviewResponse {
  return preview() as unknown as PromotionPreviewResponse;
}
