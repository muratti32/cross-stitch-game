import { escapeHtml, serializeForScript } from '../_shared/escape';

export interface Env {
  VITE_API_URL?: string;
}

interface PublicCreatorProfile {
  displayName: string;
  username: string;
}

const USERNAME_REGEX = /^[A-Za-z0-9_]{3,30}$/;

export function buildProfileApiUrl(apiUrl: string, username: string): string {
  return `${apiUrl}/v1/catalog/profiles/${encodeURIComponent(username)}`;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const rawUsername = params.username;

  if (typeof rawUsername !== 'string' || !USERNAME_REGEX.test(rawUsername)) {
    return htmlResponse(getUnavailableHtml(), 404);
  }

  const username = rawUsername.toLowerCase();
  const url = new URL(request.url);

  if (url.searchParams.has('fallback')) {
    return context.next();
  }

  const apiUrl = env.VITE_API_URL ?? 'https://stitch-wish-staging-api.avkdesign.net';

  try {
    const res = await fetch(buildProfileApiUrl(apiUrl, username));

    if (!res.ok) {
      return htmlResponse(getUnavailableHtml(), 404);
    }

    const profile = (await res.json()) as PublicCreatorProfile;
    return htmlResponse(getProfileHtml(username, profile));
  } catch {
    return htmlResponse(getFallbackHtml(username));
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

function getProfileHtml(username: string, profile: PublicCreatorProfile): string {
  const displayName = profile.displayName || `@${username}`;
  const title = `Stitch Wish - ${displayName} (@${username})`;
  const description = `View display name ${displayName} on Stitch Wish: Cross Stitch!`;
  const appLink = `stitchwish://profile/${username}`;
  const fallbackUrl = `/profile/${username}?fallback=true`;

  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const escapedFallbackUrl = escapeHtml(fallbackUrl);
  const escapedUsername = escapeHtml(username);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapedTitle}</title>
  <meta property="og:title" content="${escapedTitle}">
  <meta property="og:description" content="${escapedDescription}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://stitchwish.avkdesign.net/profile/${escapedUsername}">
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

function getFallbackHtml(username: string): string {
  const title = `Stitch Wish - @${username}`;
  const description = `Open @${username}'s profile in Stitch Wish: Cross Stitch!`;
  const appLink = `stitchwish://profile/${username}`;
  const fallbackUrl = `/profile/${username}?fallback=true`;

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
