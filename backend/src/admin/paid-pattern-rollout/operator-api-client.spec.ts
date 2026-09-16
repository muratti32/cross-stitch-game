import {
  OperatorApiClient,
  OperatorApiError,
  OperatorApiResponseError,
  type OperatorFetch,
} from './operator-api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function pattern(id: string): Record<string, unknown> {
  return {
    categoryCode: 'animals',
    id,
    patternType: 'official',
    status: 'available',
    stitchableCellCount: 5_000,
    title: `Pattern ${id}`,
    unlockPriceTier: null,
  };
}

function fetchMock(): jest.MockedFunction<OperatorFetch> {
  return jest.fn<ReturnType<OperatorFetch>, Parameters<OperatorFetch>>();
}

describe('OperatorApiClient', () => {
  it('logs in through the real MFA challenge fields and stores the bearer token', async () => {
    const mockFetch = fetchMock()
      .mockResolvedValueOnce(jsonResponse({
        challenge: 'challenge-1',
        expiresAt: '2026-09-16T00:00:00.000Z',
        status: 'mfa_required',
      }))
      .mockResolvedValueOnce(jsonResponse({
        accessToken: 'access-token',
        operator: { email: 'operator@example.com', id: 'operator', role: 'catalog_manager' },
        refreshToken: 'refresh-token',
        status: 'authenticated',
      }))
      .mockResolvedValueOnce(jsonResponse([]));
    const client = new OperatorApiClient('https://admin.example.test///', mockFetch);

    await client.login({
      email: 'operator@example.com',
      password: 'password-value',
      totpCode: '123456',
    });
    await client.getStaffPicks();

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://admin.example.test/v1/admin/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ email: 'operator@example.com', password: 'password-value' }),
        method: 'POST',
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://admin.example.test/v1/admin/auth/mfa',
      expect.objectContaining({
        body: JSON.stringify({ challenge: 'challenge-1', totpCode: '123456' }),
      }),
    );
    expect(mockFetch.mock.calls[2]?.[0]).toBe(
      'https://admin.example.test/v1/admin/staff-picks',
    );
    expect(new Headers(mockFetch.mock.calls[2]?.[1]?.headers).get('authorization'))
      .toBe('Bearer access-token');
  });

  it('pages available Patterns until the reported total is fetched', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => pattern(`pattern-${index}`));
    const mockFetch = fetchMock()
      .mockResolvedValueOnce(jsonResponse({
        accessToken: 'token',
        operator: { email: 'operator@example.com', id: 'operator', role: 'catalog_manager' },
        refreshToken: 'refresh',
        status: 'authenticated',
      }))
      .mockResolvedValueOnce(jsonResponse({ items: firstPage, page: 1, pageSize: 100, total: 101 }))
      .mockResolvedValueOnce(jsonResponse({ items: [pattern('pattern-100')], page: 2, pageSize: 100, total: 101 }));
    const client = new OperatorApiClient('https://admin.example.test', mockFetch);
    await client.login({ email: 'operator@example.com', password: 'password' });

    const result = await client.listPatterns('available');

    expect(result).toHaveLength(101);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://admin.example.test/v1/admin/patterns?status=available&page=1&pageSize=100',
      expect.anything(),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      'https://admin.example.test/v1/admin/patterns?status=available&page=2&pageSize=100',
      expect.anything(),
    );
  });

  it('generates the MFA code from a supplied TOTP secret', async () => {
    const mockFetch = fetchMock()
      .mockResolvedValueOnce(jsonResponse({
        challenge: 'challenge-1',
        expiresAt: '2026-09-16T00:00:00.000Z',
        status: 'mfa_required',
      }))
      .mockResolvedValueOnce(jsonResponse({
        accessToken: 'access-token',
        operator: { email: 'operator@example.com', id: 'operator', role: 'catalog_manager' },
        refreshToken: 'refresh-token',
        status: 'authenticated',
      }));
    const client = new OperatorApiClient('https://admin.example.test', mockFetch);

    await client.login({
      email: 'operator@example.com',
      password: 'password',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    });

    expect(mockFetch.mock.calls[1]?.[1]?.body)
      .toMatch(/^\{"challenge":"challenge-1","totpCode":"\d{6}"\}$/);
  });

  it('sends bulk paid requests with the caller request ID', async () => {
    const mockFetch = fetchMock()
      .mockResolvedValueOnce(jsonResponse({
        accessToken: 'token',
        operator: { email: 'operator@example.com', id: 'operator', role: 'catalog_manager' },
        refreshToken: 'refresh',
        status: 'authenticated',
      }))
      .mockResolvedValueOnce(jsonResponse({
        paid: true,
        results: [{
          afterTier: 'medium',
          beforeTier: null,
          grandfatheredCount: 2,
          outcome: 'changed',
          patternId: 'pattern-1',
        }],
      }));
    const client = new OperatorApiClient('https://admin.example.test', mockFetch);
    await client.login({ email: 'operator@example.com', password: 'password' });

    await expect(client.bulkSetPaid(['pattern-1'], true, 'request-1')).resolves.toMatchObject({
      paid: true,
    });
    const lastCall = mockFetch.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('https://admin.example.test/v1/admin/patterns/bulk-paid');
    expect(lastCall?.[1]?.body).toBe(JSON.stringify({ paid: true, patternIds: ['pattern-1'] }));
    expect(new Headers(lastCall?.[1]?.headers).get('x-request-id')).toBe('request-1');
  });

  it('returns parsed non-2xx bodies without putting credentials in the message', async () => {
    const mockFetch = fetchMock().mockResolvedValueOnce(
      jsonResponse({ code: 'unauthorized' }, 401),
    );
    const client = new OperatorApiClient('https://admin.example.test', mockFetch);

    try {
      await client.login({
        email: 'secret@example.com',
        password: 'sensitive-password',
        totpCode: '123456',
      });
      throw new Error('Expected login to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(OperatorApiError);
      if (error instanceof OperatorApiError) {
        expect(error.status).toBe(401);
        expect(error.body).toEqual({ code: 'unauthorized' });
        expect(error.message).not.toMatch(/secret@example|sensitive-password|123456/);
      }
    }
  });

  it('rejects malformed successful JSON shapes', async () => {
    const mockFetch = fetchMock().mockResolvedValueOnce(jsonResponse({ status: 'authenticated' }));
    const client = new OperatorApiClient('https://admin.example.test', mockFetch);

    await expect(client.login({ email: 'operator@example.com', password: 'password' }))
      .rejects.toBeInstanceOf(OperatorApiResponseError);
  });
});
