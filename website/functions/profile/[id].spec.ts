import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventContext } from '@cloudflare/workers-types';
import { buildProfileApiUrl, isPublicCreatorProfile, onRequestGet, type Env } from './[id]';

type ProfileRequestContext = Parameters<typeof onRequestGet>[0];
type IdParam = ProfileRequestContext['params']['id'];

describe('Profile Share Page - onRequestGet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const validId = '18c048bf-9c47-4f31-a3b0-a1546f77a00a';

  function createMockContext({
    id,
    url = `https://stitchwish.avkdesign.net/profile/${id}`,
    env = { VITE_API_URL: 'https://test-api.example.com' },
  }: {
    id: IdParam;
    url?: string;
    env?: Env;
  }): ProfileRequestContext {
    const request = new Request(url);
    const next = vi.fn<() => Promise<Response>>().mockResolvedValue(
      new Response('next-handler-response')
    );
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();

    return {
      request,
      functionPath: '/profile/[id]',
      waitUntil,
      next,
      env,
      params: { id },
      data: {},
    } as unknown as EventContext<Env, 'id', Record<string, unknown>>;
  }

  function expectTemporaryFailure(response: Response) {
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe('60');
  }

  function stubProfileResponse(body: unknown, init?: ResponseInit) {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
      })
    );
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  }

  function publicProfile(overrides: Record<string, unknown> = {}) {
    return {
      avatarUrl: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      displayName: 'Creator 123',
      id: validId,
      restricted: false,
      updatedAt: '2026-09-01T00:00:00.000Z',
      username: 'creator_123',
      ...overrides,
    };
  }

  describe('Identifier validation', () => {
    const invalidIds = [
      '../../health',
      '..%2F..%2Fhealth',
      '"><script>alert(1)</script>',
      'creator_123',
      '18c048bf-9c47-4f31-a3b0-a1546f77a00',
      '18c048bf-9c47-4f31-a3b0-a1546f77a00a0',
      '18c048bf9c474f31a3b0a1546f77a00a',
      'g8c048bf-9c47-4f31-a3b0-a1546f77a00a',
      '""',
    ];

    it.each(invalidIds)(
      'rejects invalid identifier "%s" and returns 404 unavailable page without fetching',
      async (invalidId) => {
        const fetchSpy = vi.fn<typeof fetch>();
        vi.stubGlobal('fetch', fetchSpy);

        const context = createMockContext({ id: invalidId });
        const response = await onRequestGet(context);

        expect(response.status).toBe(404);
        const text = await response.text();
        expect(text).toContain('Profile Unavailable');
        expect(text).toContain('This creator profile is not available.');
        expect(text).not.toContain('window.location.replace');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(context.next).not.toHaveBeenCalled();
      }
    );

    it('rejects the verbatim SAST payload without fetching', async () => {
      const fetchSpy = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchSpy);

      const context = createMockContext({
        id: '..%2F..%2Fhealth%3Fa%3D%22%2Balert(1)%2B%22',
      });
      const response = await onRequestGet(context);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('window.location.replace');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects invalid identifiers even if fallback=true is in query params', async () => {
      const fetchSpy = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchSpy);

      const context = createMockContext({
        id: '../../health',
        url: 'https://stitchwish.avkdesign.net/profile/..%2F..%2Fhealth?fallback=true',
      });
      const response = await onRequestGet(context);

      expect(response.status).toBe(404);
      expect(context.next).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('Upstream request building', () => {
    it('targets the public Creator Profile endpoint and URL-encodes identifiers', () => {
      expect(buildProfileApiUrl('https://test-api.example.com', 'a/b?c"d')).toBe(
        'https://test-api.example.com/v1/creator-profiles/a%2Fb%3Fc%22d'
      );
    });

    it('normalises identifiers before fetching and rendering links', async () => {
      const fetchSpy = stubProfileResponse(publicProfile());

      const context = createMockContext({ id: validId.toUpperCase() });
      const response = await onRequestGet(context);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        `https://test-api.example.com/v1/creator-profiles/${validId}`
      );
      expect(html).toContain(`window.location.replace("stitchwish://profile/${validId}");`);
      expect(html).toContain(
        `<a href="/profile/${validId}?fallback=true">click here to view in browser</a>`
      );
    });

    it('uses the default API URL when VITE_API_URL is an empty string', async () => {
      const fetchSpy = stubProfileResponse(publicProfile());

      const context = createMockContext({ id: validId, env: { VITE_API_URL: '' } });
      const response = await onRequestGet(context);

      expect(fetchSpy).toHaveBeenCalledWith(
        `https://stitch-wish-staging-api.avkdesign.net/v1/creator-profiles/${validId}`
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(
        '<title>Stitch Wish - Creator 123 (@creator_123)</title>'
      );
    });

    it('returns 503 fallback HTML for invalid JSON bodies', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(new Response('{not json', { status: 200 }))
      );

      const response = await onRequestGet(createMockContext({ id: validId }));
      const html = await response.text();

      expectTemporaryFailure(response);
      expect(html).toContain('<title>Stitch Wish - Creator Profile</title>');
      expect(html).not.toContain('View display name');
    });

    it.each([
      ['a null body', null],
      ['an array body', []],
      ['a body missing displayName', { username: 'creator_123' }],
      ['a body missing username', { displayName: 'Creator 123' }],
      ['a non-string displayName', { username: 'creator_123', displayName: 42 }],
      ['a non-string username', { username: 123, displayName: 'Creator 123' }],
    ])('returns 503 fallback HTML when the response fails the profile guard: %s', async (_label, body) => {
      stubProfileResponse(body);

      const response = await onRequestGet(createMockContext({ id: validId }));
      const html = await response.text();

      expectTemporaryFailure(response);
      expect(html).toContain('<title>Stitch Wish - Creator Profile</title>');
      expect(html).not.toContain('View display name');
      expect(html).not.toContain('undefined');
    });

    it.each([500, 502, 503, 504])(
      'returns 503 fallback HTML for upstream status %s instead of the unavailable page',
      async (status) => {
        vi.stubGlobal(
          'fetch',
          vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }))
        );

        const response = await onRequestGet(createMockContext({ id: validId }));

        expectTemporaryFailure(response);
        const html = await response.text();
        expect(html).toContain('<title>Stitch Wish - Creator Profile</title>');
        expect(html).not.toContain('Profile Unavailable');
        expect(html).toContain(`window.location.replace("stitchwish://profile/${validId}");`);
      }
    );

    it.each([403, 404, 410])(
      'returns 404 unavailable page for upstream status %s',
      async (status) => {
        vi.stubGlobal(
          'fetch',
          vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }))
        );

        const response = await onRequestGet(createMockContext({ id: validId }));

        expect(response.status).toBe(404);
        expect(await response.text()).toContain('Profile Unavailable');
      }
    );

    it('resolves to unavailable page for an Account Closure Hold response', async () => {
      stubProfileResponse(
        { statusCode: 404, message: 'Creator Profile not found', error: 'Not Found' },
        { status: 404 }
      );

      const response = await onRequestGet(createMockContext({ id: validId }));

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toContain('Profile Unavailable');
      expect(text).toContain('This creator profile is not available.');
    });
  });

  describe('isPublicCreatorProfile', () => {
    it('accepts the backend public Creator Profile view', () => {
      expect(isPublicCreatorProfile(publicProfile())).toBe(true);
    });

    it('accepts a restricted profile view', () => {
      expect(
        isPublicCreatorProfile(publicProfile({ displayName: 'Restricted Creator', restricted: true }))
      ).toBe(true);
    });
  });

  describe('Success branch HTML escaping and script serialization', () => {
    it('escapes attribute-breakout sequence in displayName across title and meta content attributes', async () => {
      const payload = '"><svg onload=alert(1)>';
      stubProfileResponse(publicProfile({ username: 'valid_user', displayName: payload }));

      const response = await onRequestGet(createMockContext({ id: validId }));

      expect(response.status).toBe(200);
      const html = await response.text();

      expect(html).not.toContain(payload);

      const escapedSequence = '&quot;&gt;&lt;svg onload=alert(1)&gt;';
      expect(html).toContain(`<title>Stitch Wish - ${escapedSequence} (@valid_user)</title>`);
      expect(html).toContain(`<meta property="og:title" content="Stitch Wish - ${escapedSequence} (@valid_user)">`);
      expect(html).toContain(`<meta property="og:description" content="View display name ${escapedSequence} on Stitch Wish: Cross Stitch!">`);
      expect(html).toContain(`<meta name="twitter:title" content="Stitch Wish - ${escapedSequence} (@valid_user)">`);
      expect(html).toContain(`<meta name="twitter:description" content="View display name ${escapedSequence} on Stitch Wish: Cross Stitch!">`);
    });

    it('escapes markup in the upstream username', async () => {
      const payload = '<b>x</b>';
      stubProfileResponse(publicProfile({ username: payload }));

      const response = await onRequestGet(createMockContext({ id: validId }));
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).not.toContain(payload);
      expect(html).toContain('(@&lt;b&gt;x&lt;/b&gt;)');
    });

    it('renders apostrophes, ampersands, and non-Latin characters as correct escaped visible text', async () => {
      const displayName = "O'Connor & Sons 日本語";
      stubProfileResponse(publicProfile({ username: 'art_craft', displayName }));

      const response = await onRequestGet(createMockContext({ id: validId }));

      expect(response.status).toBe(200);
      const html = await response.text();

      const expectedEscaped = 'O&#39;Connor &amp; Sons 日本語';
      expect(html).toContain(`<title>Stitch Wish - ${expectedEscaped} (@art_craft)</title>`);
      expect(html).toContain(`content="Stitch Wish - ${expectedEscaped} (@art_craft)"`);
      expect(html).toContain(`content="View display name ${expectedEscaped} on Stitch Wish: Cross Stitch!"`);
    });

    it('serialises values inside inline script blocks and uses the opaque identifier in links', async () => {
      stubProfileResponse(publicProfile({ username: 'craft_user', displayName: 'Craft User' }));

      const response = await onRequestGet(createMockContext({ id: validId }));

      expect(response.status).toBe(200);
      const html = await response.text();

      expect(html).toContain(`window.location.replace("stitchwish://profile/${validId}");`);
      expect(html).toContain(`window.location.replace("/profile/${validId}?fallback=true");`);
      expect(html).toContain(`<meta property="og:url" content="https://stitchwish.avkdesign.net/profile/${validId}">`);
      expect(html).not.toContain('stitchwish://profile/craft_user');
    });
  });

  describe('Fallback branch (backend unreachable or error thrown)', () => {
    it('returns 503 fallback HTML when fetch rejects and serialises values safely', async () => {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('Connection refused')));

      const response = await onRequestGet(createMockContext({ id: validId }));

      expectTemporaryFailure(response);
      const html = await response.text();

      expect(html).toContain('<title>Stitch Wish - Creator Profile</title>');
      expect(html).toContain('<meta property="og:title" content="Stitch Wish - Creator Profile">');
      expect(html).toContain('<meta property="og:description" content="Open this creator&#39;s profile in Stitch Wish: Cross Stitch!">');
      expect(html).toContain(`window.location.replace("stitchwish://profile/${validId}");`);
      expect(html).toContain(`window.location.replace("/profile/${validId}?fallback=true");`);
      expect(html).toContain(`<a href="/profile/${validId}?fallback=true">click here</a>`);
    });
  });

  describe('SPA fallback query parameter', () => {
    it('passes to context.next() when fallback=true for a valid identifier', async () => {
      const fetchSpy = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchSpy);

      const context = createMockContext({
        id: validId,
        url: `https://stitchwish.avkdesign.net/profile/${validId}?fallback=true`,
      });
      const response = await onRequestGet(context);

      expect(context.next).toHaveBeenCalledTimes(1);
      expect(await response.text()).toBe('next-handler-response');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
