import { escapeHtml, serializeForScript } from '../_shared/escape';

export interface Env {
  VITE_API_URL?: string;
}

export interface CatalogPattern {
  title: string;
  creatorName: string;
  width: number;
  height: number;
  paletteSize: number;
  previewUrl: string | null;
  thumbnailUrls: { browsing: string; detail: string } | null;
}

const PATTERN_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function buildPatternApiUrl(apiUrl: string, id: string): string {
  return `${apiUrl}/v1/catalog/patterns/${encodeURIComponent(id)}`;
}

export function isHttpsUrl(url: string | null | undefined): url is string {
  if (!url) return false;

  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function hasProperty<K extends PropertyKey>(
  value: object,
  key: K
): value is object & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isThumbnailUrls(
  value: unknown
): value is { browsing: string; detail: string } | null {
  if (value === null) return true;
  if (typeof value !== 'object') return false;

  return (
    hasProperty(value, 'browsing') &&
    typeof value.browsing === 'string' &&
    hasProperty(value, 'detail') &&
    typeof value.detail === 'string'
  );
}

export function isCatalogPattern(value: unknown): value is CatalogPattern {
  if (typeof value !== 'object' || value === null) return false;

  if (
    !hasProperty(value, 'title') ||
    !hasProperty(value, 'creatorName') ||
    !hasProperty(value, 'width') ||
    !hasProperty(value, 'height') ||
    !hasProperty(value, 'paletteSize') ||
    !hasProperty(value, 'previewUrl') ||
    !hasProperty(value, 'thumbnailUrls')
  ) {
    return false;
  }

  return (
    typeof value.title === 'string' &&
    value.title.trim().length > 0 &&
    typeof value.creatorName === 'string' &&
    value.creatorName.trim().length > 0 &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    isFiniteNumber(value.paletteSize) &&
    (value.previewUrl === null || typeof value.previewUrl === 'string') &&
    isThumbnailUrls(value.thumbnailUrls)
  );
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const rawId = params.id;

  if (typeof rawId !== 'string') {
    return htmlResponse(getUnavailableHtml(), 404);
  }

  const id = rawId.toLowerCase();
  if (!PATTERN_ID_REGEX.test(id)) {
    return htmlResponse(getUnavailableHtml(), 404);
  }

  const url = new URL(request.url);

  // fallback=true is the browser landing target of the redirect script: serve the static SPA.
  if (url.searchParams.has('fallback')) {
    return context.next();
  }

  const apiUrl = env.VITE_API_URL || 'https://stitch-wish-staging-api.avkdesign.net';

  try {
    const res = await fetch(buildPatternApiUrl(apiUrl, id));

    if (!res.ok) {
      // The backend answers non-OK for patterns it will not show (e.g. Review Hold, Account Closure Hold,
      // Catalog Withdrawal, Safety Removal), so render the static unavailable page.
      return htmlResponse(getUnavailableHtml(), 404);
    }

    const value: unknown = await res.json();

    if (!isCatalogPattern(value)) {
      // A structurally invalid upstream body is handled like an upstream failure.
      return htmlResponse(getFallbackHtml(id));
    }

    return htmlResponse(getPatternHtml(id, value));
  } catch {
    // Network or JSON parse errors cannot establish availability, so return the 200 redirect fallback.
    return htmlResponse(getFallbackHtml(id));
  }
};

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
}

function redirectScript(appLink: string, fallbackUrl: string): string {
  return `window.location.replace(${serializeForScript(appLink)});
    setTimeout(function() {
      window.location.replace(${serializeForScript(fallbackUrl)});
    }, 1500);`;
}

function getPatternHtml(id: string, pattern: CatalogPattern): string {
  const pageTitle = `Stitch Wish - ${pattern.title}`;
  const description = `Play '${pattern.title}' by ${pattern.creatorName} (${pattern.width}x${pattern.height}, ${pattern.paletteSize} colors) in Stitch Wish: Cross Stitch!`;
  const appLink = `stitchwish://catalog/pattern/${id}`;
  const fallbackUrl = `/pattern/${id}?fallback=true`;
  const canonicalUrl = `https://stitchwish.avkdesign.net/pattern/${id}`;

  const candidateImageUrl = pattern.thumbnailUrls?.detail || pattern.previewUrl;
  const imageUrl = isHttpsUrl(candidateImageUrl) ? candidateImageUrl : null;

  const escapedTitle = escapeHtml(pageTitle);
  const escapedDescription = escapeHtml(description);
  const escapedFallbackUrl = escapeHtml(fallbackUrl);
  const escapedCanonicalUrl = escapeHtml(canonicalUrl);
  const escapedImageUrl = imageUrl ? escapeHtml(imageUrl) : null;

  const imageMetaTags = escapedImageUrl
    ? `  <meta property="og:image" content="${escapedImageUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${escapedImageUrl}">`
    : `  <meta name="twitter:card" content="summary">`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapedTitle}</title>
  <meta property="og:title" content="${escapedTitle}">
  <meta property="og:description" content="${escapedDescription}">
${imageMetaTags}
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapedCanonicalUrl}">
  <meta name="twitter:title" content="${escapedTitle}">
  <meta name="twitter:description" content="${escapedDescription}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>
    ${redirectScript(appLink, fallbackUrl)}
  </script>
</head>
<body>
  <p>Redirecting to Stitch Wish app... If the app does not open, <a href="${escapedFallbackUrl}">click here to view in browser</a>.</p>
</body>
</html>`;
}

function getFallbackHtml(id: string): string {
  const pageTitle = 'Stitch Wish - View Pattern';
  const description = 'Open this pattern in Stitch Wish: Cross Stitch!';
  const appLink = `stitchwish://catalog/pattern/${id}`;
  const fallbackUrl = `/pattern/${id}?fallback=true`;

  const escapedTitle = escapeHtml(pageTitle);
  const escapedDescription = escapeHtml(description);
  const escapedFallbackUrl = escapeHtml(fallbackUrl);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapedTitle}</title>
  <meta property="og:title" content="${escapedTitle}">
  <meta property="og:description" content="${escapedDescription}">
  <meta property="og:type" content="website">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>
    ${redirectScript(appLink, fallbackUrl)}
  </script>
</head>
<body>
  <p>Redirecting... If nothing happens, <a href="${escapedFallbackUrl}">click here</a>.</p>
</body>
</html>`;
}

function getUnavailableHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Content Unavailable - Stitch Wish</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 50px 20px; background: #FAF6F0; color: #4A4A4A; }
    h1 { color: #D9534F; }
    .card { background: white; padding: 30px; border-radius: 12px; max-width: 400px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    a { color: #2D6A4F; text-decoration: none; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Content Unavailable</h1>
    <p>This pattern is no longer available. It may have been withdrawn by its creator or removed by moderation.</p>
    <p><a href="/">Go to Home Page</a></p>
  </div>
</body>
</html>`;
}
