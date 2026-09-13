import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventContext } from '@cloudflare/workers-types';
import { buildProfileApiUrl, onRequestGet, type Env } from './[username]';

type ProfileRequestContext = Parameters<typeof onRequestGet>[0];
type UsernameParam = ProfileRequestContext['params']['username'];

describe('Profile Share Page - onRequestGet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function createMockContext({
    username,
    url = `https://stitchwish.avkdesign.net/profile/${username}`,
    env = { VITE_API_URL: 'https://test-api.example.com' },
  }: {
    username: UsernameParam;
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
      functionPath: '/profile/[username]',
      waitUntil,
      next,
      env,
      params: { username },
      data: {},
    } as unknown as EventContext<Env, 'username', Record<string, unknown>>;
  }

  describe('Identifier validation', () => {
    const invalidUsernames = [
      '../../health',
      '..%2F..%2Fhealth',
      '"><script>alert(1)</script>',
      'ab',
      'a'.repeat(31),
      'user@name',
      'user name',
      'user-name',
      'user.name',
      '""',
    ];

    it.each(invalidUsernames)(
      'rejects invalid identifier "%s" and returns 404 unavailable page without fetching',
      async (invalidId) => {
        const fetchSpy = vi.fn<typeof fetch>();
        vi.stubGlobal('fetch', fetchSpy);

        const context = createMockContext({ username: invalidId });
        const response = await onRequestGet(context);

        expect(response.status).toBe(404);
        const text = await response.text();
        expect(text).toContain('Profile Unavailable');
        expect(text).toContain('This creator profile is not available.');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(context.next).not.toHaveBeenCalled();
      }
    );

    it('rejects an identifier containing a quote without rendering a redirect script or fetching', async () => {
      const fetchSpy = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchSpy);

      const context = createMockContext({ username: 'a"bc' });
      const response = await onRequestGet(context);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('window.location.replace');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects the verbatim SAST payload without fetching', async () => {
      const fetchSpy = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchSpy);

      const context = createMockContext({
        username: '..%2F..%2Fhealth%3Fa%3D%22%2Balert(1)%2B%22',
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
        username: '../../health',
        url: 'https://stitchwish.avkdesign.net/profile/..%2F..%2Fhealth?fallback=true',
      });
      const response = await onRequestGet(context);

      expect(response.status).toBe(404);
      expect(context.next).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('Upstream request building', () => {
    it('URL-encodes identifiers with buildProfileApiUrl', () => {
      expect(
        buildProfileApiUrl('https://test-api.example.com', 'a/b?c"d')
      ).toBe('https://test-api.example.com/v1/catalog/profiles/a%2Fb%3Fc%22d');
    });

    it('normalises identifiers before fetching and rendering links', async () => {
      const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ username: 'creator_123', displayName: 'Creator 123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', fetchSpy);

      const context = createMockContext({ username: 'Creator_123' });
      const response = await onRequestGet(context);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        'https://test-api.example.com/v1/catalog/profiles/creator_123'
      );
      expect(html).toContain('window.location.replace("stitchwish://profile/creator_123");');
      expect(html).toContain('<a href="/profile/creator_123?fallback=true">click here to view in browser</a>');
    });

    it('resolves to unavailable page for an Account Closure Hold response', async () => {
      const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          '{"statusCode":404,"message":"Creator Profile not found","error":"Not Found"}',
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );
      vi.stubGlobal('fetch', fetchSpy);

      const context = createMockContext({ username: 'closed_account' });
      const response = await onRequestGet(context);

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toContain('Profile Unavailable');
      expect(text).toContain('This creator profile is not available.');
    });
  });

  describe('Success branch HTML escaping and script serialization', () => {
    it('escapes attribute-breakout sequence in displayName across title and meta content attributes', async () => {
      const payload = '"><svg onload=alert(1)>';
      const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ username: 'valid_user', displayName: payload }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', fetchSpy);

      const context = createMockContext({ username: 'valid_user' });
      const response = await onRequestGet(context);

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

    it('renders apostrophes, ampersands, and non-Latin characters as correct escaped visible text', async () => {
      const displayName = "O'Connor & Sons 日本語";
      const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ username: 'art_craft', displayName }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', fetchSpy);

      const context = createMockContext({ username: 'art_craft' });
      const response = await onRequestGet(context);

      expect(response.status).toBe(200);
      const html = await response.text();

      const expectedEscaped = "O&#39;Connor &amp; Sons 日本語";
      expect(html).toContain(`<title>Stitch Wish - ${expectedEscaped} (@art_craft)</title>`);
      expect(html).toContain(`content="Stitch Wish - ${expectedEscaped} (@art_craft)"`);
      expect(html).toContain(`content="View display name ${expectedEscaped} on Stitch Wish: Cross Stitch!"`);
    });

    it('serialises values inside inline script blocks as JavaScript literals', async () => {
      const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ username: 'craft_user', displayName: 'Craft User' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', fetchSpy);

      const context = createMockContext({ username: 'craft_user' });
      const response = await onRequestGet(context);

      expect(response.status).toBe(200);
      const html = await response.text();

      expect(html).toContain('window.location.replace("stitchwish://profile/craft_user");');
      expect(html).toContain('window.location.replace("/profile/craft_user?fallback=true");');
      expect(html).toContain('<a href="/profile/craft_user?fallback=true">click here to view in browser</a>');
    });
  });

  describe('Fallback branch (backend unreachable or error thrown)', () => {
    it('covers the fallback branch when fetch rejects and serialises values safely', async () => {
      const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(new Error('Connection refused'));
      vi.stubGlobal('fetch', fetchSpy);

      const context = createMockContext({ username: 'offline_user' });
      const response = await onRequestGet(context);

      expect(response.status).toBe(200);
      const html = await response.text();

      expect(html).toContain('<title>Stitch Wish - @offline_user</title>');
      expect(html).toContain('<meta property="og:title" content="Stitch Wish - @offline_user">');
      expect(html).toContain('<meta property="og:description" content="Open @offline_user&#39;s profile in Stitch Wish: Cross Stitch!">');
      expect(html).toContain('window.location.replace("stitchwish://profile/offline_user");');
      expect(html).toContain('window.location.replace("/profile/offline_user?fallback=true");');
      expect(html).toContain('<a href="/profile/offline_user?fallback=true">click here</a>');
    });
  });

  describe('SPA fallback query parameter', () => {
    it('passes to context.next() when fallback=true for valid username', async () => {
      const fetchSpy = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchSpy);

      const context = createMockContext({
        username: 'valid_user',
        url: 'https://stitchwish.avkdesign.net/profile/valid_user?fallback=true',
      });
      const response = await onRequestGet(context);

      expect(context.next).toHaveBeenCalledTimes(1);
      expect(await response.text()).toBe('next-handler-response');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
