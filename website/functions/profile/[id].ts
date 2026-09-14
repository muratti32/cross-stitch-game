import { escapeHtml, serializeForScript } from '../_shared/escape';

export interface Env {
  VITE_API_URL?: string;
}

interface PublicCreatorProfile {
  displayName: string;
  username: string;
}

const PROFILE_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function hasProperty<K extends PropertyKey>(
  value: object,
  key: K
): value is object & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isPublicCreatorProfile(value: unknown): value is PublicCreatorProfile {
  if (typeof value !== 'object' || value === null) return false;

  return (
    hasProperty(value, 'displayName') &&
    typeof value.displayName === 'string' &&
    hasProperty(value, 'username') &&
    typeof value.username === 'string'
  );
}

// Catalog Share Links use the opaque profile identifier (ADR-0022), which survives Moderator Username Reset.
export function buildProfileApiUrl(apiUrl: string, id: string): string {
  return `${apiUrl}/v1/creator-profiles/${encodeURIComponent(id)}`;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const rawId = params.id;

  if (typeof rawId !== 'string') {
    return htmlResponse(getUnavailableHtml(), 404);
  }

  const id = rawId.toLowerCase();
  if (!PROFILE_ID_REGEX.test(id)) {
    return htmlResponse(getUnavailableHtml(), 404);
  }

  const url = new URL(request.url);

  if (url.searchParams.has('fallback')) {
    return context.next();
  }

  const apiUrl = env.VITE_API_URL || 'https://stitch-wish-staging-api.avkdesign.net';

  try {
    const res = await fetch(buildProfileApiUrl(apiUrl, id));

    if (!res.ok) {
      return htmlResponse(getUnavailableHtml(), 404);
    }

    const value: unknown = await res.json();

    if (!isPublicCreatorProfile(value)) {
      // A structurally invalid upstream body is handled like an upstream failure.
      return htmlResponse(getFallbackHtml(id));
    }

    return htmlResponse(getProfileHtml(id, value));
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

function getProfileHtml(id: string, profile: PublicCreatorProfile): string {
  const { username } = profile;
  const displayName = profile.displayName || `@${username}`;
  const title = `Stitch Wish - ${displayName} (@${username})`;
  const description = `View display name ${displayName} on Stitch Wish: Cross Stitch!`;
  const appLink = `stitchwish://profile/${id}`;
  const fallbackUrl = `/profile/${id}?fallback=true`;
  const canonicalUrl = `https://stitchwish.avkdesign.net/profile/${id}`;

  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const escapedFallbackUrl = escapeHtml(fallbackUrl);
  const escapedCanonicalUrl = escapeHtml(canonicalUrl);
  const escapedUsername = escapeHtml(username);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapedTitle}</title>
  <meta property="og:title" content="${escapedTitle}">
  <meta property="og:description" content="${escapedDescription}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapedCanonicalUrl}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapedTitle}">
  <meta name="twitter:description" content="${escapedDescription}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>
    ${redirectScript(appLink, fallbackUrl)}
  </script>
</head>
<body>
  <p>Redirecting to @${escapedUsername}'s profile in Stitch Wish... If the app does not open, <a href="${escapedFallbackUrl}">click here to view in browser</a>.</p>
</body>
</html>`;
}

function getFallbackHtml(id: string): string {
  const title = 'Stitch Wish - Creator Profile';
  const description = "Open this creator's profile in Stitch Wish: Cross Stitch!";
  const appLink = `stitchwish://profile/${id}`;
  const fallbackUrl = `/profile/${id}?fallback=true`;

  const escapedTitle = escapeHtml(title);
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
  <title>Creator Profile - Stitch Wish</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 50px 20px; background: #FAF6F0; color: #4A4A4A; }
    h1 { color: #8F8F8F; }
    .card { background: white; padding: 30px; border-radius: 12px; max-width: 400px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    a { color: #2D6A4F; text-decoration: none; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Profile Unavailable</h1>
    <p>This creator profile is not available.</p>
    <p><a href="/">Go to Home Page</a></p>
  </div>
</body>
</html>`;
}
