import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventContext } from '@cloudflare/workers-types';
import { serializeForScript } from '../_shared/escape';
import {
  buildPatternApiUrl,
  isHttpsUrl,
  onRequestGet,
  type CatalogPattern,
  type Env,
} from './[id]';

type PatternRequestContext = Parameters<typeof onRequestGet>[0];

describe('Pattern Share Page - onRequestGet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const validUuid = '12345678-1234-4234-8234-123456789abc';

  function createMockContext({
    id,
    url = `https://stitchwish.avkdesign.net/pattern/${id}`,
    env = { VITE_API_URL: 'https://test-api.example.com' },
  }: {
    id?: string;
    url?: string;
    env?: Env;
  }): PatternRequestContext {
    const request = new Request(url);
    const next = vi.fn<() => Promise<Response>>().mockResolvedValue(
      new Response('next-handler-response')
    );
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();

    return {
      request,
      functionPath: '/pattern/[id]',
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

  function stubCatalogResponse(body: unknown, init?: ResponseInit) {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(body), init)
    );
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  }

  function extractPatternMetadata(html: string): {
    titleText: string;
    ogTitle: string;
    ogDescription: string;
    twitterTitle: string;
    twitterDescription: string;
  } {
    const extract = (expression: RegExp): string => {
      const match = html.match(expression);
      if (!match) {
        throw new Error(`Could not extract metadata with ${expression}`);
      }
      return match[1] ?? '';
    };

    return {
      titleText: extract(/<title>([^<]*)<\/title>/),
      ogTitle: extract(/<meta property="og:title" content="([^"]*)">/),
      ogDescription: extract(/<meta property="og:description" content="([^"]*)">/),
      twitterTitle: extract(/<meta name="twitter:title" content="([^"]*)">/),
      twitterDescription: extract(
        /<meta name="twitter:description" content="([^"]*)">/
      ),
    };
  }

  function extractScriptBody(html: string): string {
    const match = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
    if (!match) {
      throw new Error('Could not extract script body');
    }
    return match[1] ?? '';
  }

  function extractReplaceArguments(scriptBody: string): string[] {
    return [...scriptBody.matchAll(/window\.location\.replace\(([^)]*)\);/g)].map(
      (match) => match[1] ?? ''
    );
  }

  function expectRedirectScript(html: string, expectedUrls: string[]): void {
    const argumentsInScript = extractReplaceArguments(extractScriptBody(html));

    expect(argumentsInScript).toEqual(expectedUrls.map(serializeForScript));
    expect(
      argumentsInScript.map((argument) => JSON.parse(argument) as unknown)
    ).toEqual(expectedUrls);
  }

  const mockPattern: CatalogPattern = {
    title: 'Spring Flowers',
    creatorName: 'Alice',
    width: 32,
    height: 32,
    paletteSize: 12,
    previewUrl: 'https://cdn.example.com/preview.png',
    thumbnailUrls: {
      browsing: 'https://cdn.example.com/thumb-browsing.png',
      detail: 'https://cdn.example.com/thumb-detail.png',
    },
  };

  describe('Identifier validation', () => {
    const invalidIds = [
      '../../health',
      '..%2F..%2Fhealth',
      '"><script>alert(1)</script>',
      '123',
      'pattern-1',
      'not-a-valid-uuid',
      '12345678-1234-1234-1234',
      '12345678-1234-1234-1234-123456789abcdef',
      '12345678-1234-1234-1234-123456789abg',
      '""',
      'a"bc',
    ];

    it.each(invalidIds)(
      'rejects invalid identifier "%s" and returns 404 unavailable page without fetching',
      async (invalidId) => {
        const fetchSpy = stubCatalogResponse({});

        const context = createMockContext({ id: invalidId });
        const response = await onRequestGet(context);

        expect(response.status).toBe(404);
        const text = await response.text();
        expect(text).toContain('Content Unavailable');
        expect(text).toContain('This pattern is no longer available.');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(context.next).not.toHaveBeenCalled();
      }
    );

    it('rejects an identifier containing quotes without rendering a redirect script or fetching', async () => {
      const fetchSpy = stubCatalogResponse({});

      const context = createMockContext({
        id: '12345678-1234-1234-1234-"23456789abc',
      });
      const response = await onRequestGet(context);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('window.location.replace');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects the verbatim SAST path traversal payload without fetching', async () => {
      const fetchSpy = stubCatalogResponse({});

      const context = createMockContext({
        id: '..%2F..%2Fhealth%3Fa%3D%22%2Balert(1)%2B%22',
      });
      const response = await onRequestGet(context);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('window.location.replace');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects invalid identifiers even if fallback=true is in query params', async () => {
      const fetchSpy = stubCatalogResponse({});

      const context = createMockContext({
        id: '../../admin',
        url: 'https://stitchwish.avkdesign.net/pattern/../../admin?fallback=true',
      });
      const response = await onRequestGet(context);

      expect(response.status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(context.next).not.toHaveBeenCalled();
    });

    it('rejects missing or non-string id parameter', async () => {
      const fetchSpy = stubCatalogResponse({});

      const context = createMockContext({});
      const response = await onRequestGet(context);

      expect(response.status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('buildPatternApiUrl', () => {
    it('constructs catalog pattern endpoint with encoded id', () => {
      expect(
        buildPatternApiUrl('https://api.example.com', validUuid)
      ).toBe(`https://api.example.com/v1/catalog/patterns/${validUuid}`);
    });

    it('properly encodes special characters in id if passed directly', () => {
      expect(
        buildPatternApiUrl('https://api.example.com', 'test/slash')
      ).toBe('https://api.example.com/v1/catalog/patterns/test%2Fslash');
    });
  });

  describe('isHttpsUrl', () => {
    it('accepts only valid https URLs', () => {
      expect(isHttpsUrl('https://example.com/img.png')).toBe(true);
      expect(isHttpsUrl('http://example.com/img.png')).toBe(false);
    });

    it('rejects non-https protocols and malformed inputs', () => {
      expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
      expect(isHttpsUrl('data:image/png;base64,...')).toBe(false);
      expect(isHttpsUrl('')).toBe(false);
      expect(isHttpsUrl(null)).toBe(false);
      expect(isHttpsUrl(undefined)).toBe(false);
      expect(isHttpsUrl('not a URL')).toBe(false);
      expect(isHttpsUrl('https://')).toBe(false);
    });
  });

  describe('Upstream request building', () => {
    it('URL-encodes the lowercased id using the default API URL', async () => {
      const fetchSpy = stubCatalogResponse(mockPattern);
      const context = createMockContext({
        id: validUuid.toUpperCase(),
        env: {},
      });

      await onRequestGet(context);

      expect(fetchSpy).toHaveBeenCalledWith(
        `https://stitch-wish-staging-api.avkdesign.net/v1/catalog/patterns/${encodeURIComponent(
          validUuid
        )}`
      );
    });

    it('URL-encodes the id using a custom API URL', async () => {
      const apiUrl = 'https://custom-api.example.com';
      const fetchSpy = stubCatalogResponse(mockPattern);
      const context = createMockContext({
        id: validUuid,
        env: { VITE_API_URL: apiUrl },
      });

      await onRequestGet(context);

      expect(fetchSpy).toHaveBeenCalledWith(
        `${apiUrl}/v1/catalog/patterns/${encodeURIComponent(validUuid)}`
      );
    });

    it('uses the default API URL when VITE_API_URL is an empty string', async () => {
      const fetchSpy = stubCatalogResponse(mockPattern);
      const context = createMockContext({
        id: validUuid,
        env: { VITE_API_URL: '' },
      });

      await onRequestGet(context);

      expect(fetchSpy).toHaveBeenCalledWith(
        `https://stitch-wish-staging-api.avkdesign.net/v1/catalog/patterns/${encodeURIComponent(
          validUuid
        )}`
      );
    });
  });

  describe('Successful pattern share page rendering', () => {
    it('fetches metadata and renders escaped OpenGraph and Twitter tags', async () => {
      stubCatalogResponse(mockPattern);

      const context = createMockContext({ id: validUuid });
      const response = await onRequestGet(context);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/html');

      const html = await response.text();
      expect(html).toContain('<title>Stitch Wish - Spring Flowers</title>');
      expect(html).toContain(
        'property="og:title" content="Stitch Wish - Spring Flowers"'
      );
      expect(html).toContain(
        'property="og:image" content="https://cdn.example.com/thumb-detail.png"'
      );
      expect(html).toContain(
        'name="twitter:card" content="summary_large_image"'
      );
      expect(html).toContain(
        'name="twitter:image" content="https://cdn.example.com/thumb-detail.png"'
      );
      expect(html).toContain(
        `https://stitchwish.avkdesign.net/pattern/${validUuid}`
      );
      expect(html).toContain(
        `stitchwish://catalog/pattern/${validUuid}`
      );
    });

    it('normalises uppercase UUID to lowercase when querying API', async () => {
      const fetchSpy = stubCatalogResponse(mockPattern);

      const uppercaseUuid = validUuid.toUpperCase();
      const context = createMockContext({ id: uppercaseUuid });
      const response = await onRequestGet(context);

      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        `https://test-api.example.com/v1/catalog/patterns/${validUuid}`
      );
    });

    it('escapes attribute-breakout payloads in title metadata fields', async () => {
      const payload = '"><img src=x onerror=alert(1)>';
      stubCatalogResponse({
        ...mockPattern,
        title: payload,
        creatorName: 'Alice',
      });

      const response = await onRequestGet(createMockContext({ id: validUuid }));
      const html = await response.text();
      const metadata = extractPatternMetadata(html);
      const escapedPayload = '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;';

      for (const value of Object.values(metadata)) {
        expect(value).toContain(escapedPayload);
      }
      expect(html).not.toContain('"><img');
    });

    it('escapes attribute-breakout payloads in creatorName description fields', async () => {
      const payload = '"><img src=x onerror=alert(1)>';
      stubCatalogResponse({
        ...mockPattern,
        title: 'Spring Flowers',
        creatorName: payload,
      });

      const response = await onRequestGet(createMockContext({ id: validUuid }));
      const html = await response.text();
      const metadata = extractPatternMetadata(html);
      const escapedPayload = '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;';

      expect(metadata.titleText).not.toContain(escapedPayload);
      expect(metadata.ogTitle).not.toContain(escapedPayload);
      expect(metadata.twitterTitle).not.toContain(escapedPayload);
      expect(metadata.ogDescription).toContain(escapedPayload);
      expect(metadata.twitterDescription).toContain(escapedPayload);
      expect(html).not.toContain('"><img');
    });

    it('renders apostrophes, ampersands, and non-Latin characters safely', async () => {
      stubCatalogResponse({
        ...mockPattern,
        title: "Anne's Rose & 花 — Çiçek",
        creatorName: 'Zoë Øster',
      });

      const response = await onRequestGet(createMockContext({ id: validUuid }));
      const html = await response.text();

      expect(html).toContain('Anne&#39;s Rose &amp; 花 — Çiçek');
      expect(html).toContain('Zoë Øster');
      expect(html).toContain('&#39;');
      expect(html).toContain('&amp;');
    });

    it('serialises deep-link and fallback URLs as JavaScript literals', async () => {
      stubCatalogResponse(mockPattern);

      const response = await onRequestGet(createMockContext({ id: validUuid }));
      const html = await response.text();

      expectRedirectScript(html, [
        `stitchwish://catalog/pattern/${validUuid}`,
        `/pattern/${validUuid}?fallback=true`,
      ]);
    });

    it('serialises double quotes and script tags safely', () => {
      const literal = serializeForScript('a"b</script>');

      expect(literal).not.toContain('</script>');
      // Only the two delimiters remain once escaped quotes (\") are removed.
      expect(literal.replace(/\\"/g, '').match(/"/g)).toHaveLength(2);
      expect(JSON.parse(literal)).toBe('a"b</script>');
    });

    it('omits image metadata when image URLs are missing or invalid protocol', async () => {
      stubCatalogResponse({
        title: 'Geometric',
        creatorName: 'Bob',
        width: 20,
        height: 20,
        paletteSize: 4,
        previewUrl: 'javascript:alert(1)',
        thumbnailUrls: null,
      });

      const response = await onRequestGet(createMockContext({ id: validUuid }));
      const html = await response.text();

      expect(html).not.toContain('property="og:image"');
      expect(html).not.toContain('name="twitter:image"');
      expect(html).toContain('name="twitter:card" content="summary"');
    });
  });

  describe('Upstream error and fallback handling', () => {
    it('returns 503 fallback HTML when fetch rejects', async () => {
      const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(
        new Error('Upstream connection timeout')
      );
      vi.stubGlobal('fetch', fetchSpy);

      const response = await onRequestGet(createMockContext({ id: validUuid }));

      expectTemporaryFailure(response);
      const html = await response.text();
      expect(html).toContain('<title>Stitch Wish - View Pattern</title>');
      expectRedirectScript(html, [
        `stitchwish://catalog/pattern/${validUuid}`,
        `/pattern/${validUuid}?fallback=true`,
      ]);
      expect((html.match(/<script>/g) ?? []).length).toBe(1);
    });

    it('returns 503 fallback HTML for invalid JSON bodies', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(new Response('{not json'))
      );

      const response = await onRequestGet(createMockContext({ id: validUuid }));

      expectTemporaryFailure(response);
      expect(await response.text()).toContain(
        '<title>Stitch Wish - View Pattern</title>'
      );
    });

    it('returns 503 fallback HTML when the response fails the catalog guard', async () => {
      stubCatalogResponse({
        creatorName: 'Alice',
        width: 32,
        height: 32,
        paletteSize: 12,
        previewUrl: null,
        thumbnailUrls: null,
      });

      const response = await onRequestGet(createMockContext({ id: validUuid }));

      expectTemporaryFailure(response);
      expect(await response.text()).toContain(
        '<title>Stitch Wish - View Pattern</title>'
      );
    });

    it.each([500, 502, 503, 504])(
      'returns 503 fallback HTML for upstream status %s instead of the unavailable page',
      async (status) => {
        stubCatalogResponse({}, { status });

        const response = await onRequestGet(createMockContext({ id: validUuid }));

        expectTemporaryFailure(response);
        const html = await response.text();
        expect(html).toContain('<title>Stitch Wish - View Pattern</title>');
        expect(html).not.toContain('Content Unavailable');
        expectRedirectScript(html, [
          `stitchwish://catalog/pattern/${validUuid}`,
          `/pattern/${validUuid}?fallback=true`,
        ]);
      }
    );

    it.each([403, 404, 410])(
      'returns 404 Content Unavailable for upstream status %s',
      async (status) => {
        stubCatalogResponse({}, { status });

        const response = await onRequestGet(
          createMockContext({ id: validUuid })
        );

        expect(response.status).toBe(404);
        const html = await response.text();
        expect(html).toContain('<title>Content Unavailable - Stitch Wish</title>');
        expect(html).toContain('<h1>Content Unavailable</h1>');
        expect(html).toContain('This pattern is no longer available.');
      }
    );

    it('delegates to SPA via context.next() when fallback=true is present for a valid id', async () => {
      const fetchSpy = stubCatalogResponse({});

      const context = createMockContext({
        id: validUuid,
        url: `https://stitchwish.avkdesign.net/pattern/${validUuid}?fallback=true`,
      });
      const response = await onRequestGet(context);

      expect(context.next).toHaveBeenCalledTimes(1);
      expect(await response.text()).toBe('next-handler-response');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
