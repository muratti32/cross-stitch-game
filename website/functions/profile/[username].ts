interface Env {
  VITE_API_URL?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const username = params.username as string;
  const url = new URL(request.url);

  // If the query parameter 'fallback=true' is present, serve the static SPA (Vite React app)
  if (url.searchParams.has('fallback')) {
    return context.next();
  }

  // Otherwise, construct profile SEO metadata
  // Since public creator profiles (#24) are still open/unimplemented in the backend,
  // we will try to fetch the profile, but catch and return a placeholder/coming-soon or unavailable page.
  const apiUrl = env.VITE_API_URL || 'https://stitch-wish-staging-api.avkdesign.net'; // fallback
  
  try {
    const res = await fetch(`${apiUrl}/v1/catalog/profiles/${username}`);
    
    if (!res.ok) {
      // If the profile is not found, return the unavailable page
      return new Response(getUnavailableHtml("Profile"), {
        status: 404,
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    const profile = await res.json() as any;

    const html = getProfileHtml(username, profile);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  } catch {
    // Fallback to dynamic placeholder page for now
    const html = getFallbackHtml(username, "Profile");
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }
};

function getProfileHtml(username: string, profile: any): string {
  const title = `Stitch Wish - @${username}`;
  const displayName = profile.displayName || `@${username}`;
  const description = `View display name ${displayName} on Stitch Wish: Cross Stitch!`;
  const appLink = `stitchwish://profile/${username}`;
  const fallbackUrl = `/profile/${username}?fallback=true`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://stitchwish.avkdesign.net/profile/${username}">
  <meta name="viewport" content="width=device-width, initial-scale=device-width, initial-scale=1">
  <script>
    window.location.replace("${appLink}");
    setTimeout(function() {
      window.location.replace("${fallbackUrl}");
    }, 1500);
  </script>
</head>
<body>
  <p>Redirecting to @${username}'s profile in Stitch Wish... If the app does not open, <a href="${fallbackUrl}">click here to view in browser</a>.</p>
</body>
</html>`;
}

function getFallbackHtml(username: string, _type: string): string {
  const title = `Stitch Wish - @${username}`;
  const description = `Open @${username}'s profile in Stitch Wish: Cross Stitch!`;
  const appLink = `stitchwish://profile/${username}`;
  const fallbackUrl = `/profile/${username}?fallback=true`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta name="viewport" content="width=device-width, initial-scale=device-width, initial-scale=1">
  <script>
    window.location.replace("${appLink}");
    setTimeout(function() {
      window.location.replace("${fallbackUrl}");
    }, 1500);
  </script>
</head>
<body>
  <p>Redirecting... If nothing happens, <a href="${fallbackUrl}">click here</a>.</p>
</body>
</html>`;
}

function getUnavailableHtml(_type: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Creator Profile - Stitch Wish</title>
  <meta name="viewport" content="width=device-width, initial-scale=device-width, initial-scale=1">
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
    <p>This creator profile is not available or is under moderation review.</p>
    <p><a href="/">Go to Home Page</a></p>
  </div>
</body>
</html>`;
}
