interface Env {
  VITE_API_URL?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const id = params.id as string;
  const url = new URL(request.url);

  // If the query parameter 'fallback=true' is present, serve the static SPA (Vite React app)
  if (url.searchParams.has('fallback')) {
    return context.next();
  }

  // Otherwise, fetch pattern metadata from backend to construct SEO / OpenGraph tags
  const apiUrl = env.VITE_API_URL || 'https://stitch-wish-staging-api.avkdesign.net'; // fallback
  
  try {
    const res = await fetch(`${apiUrl}/v1/catalog/patterns/${id}`);
    
    if (!res.ok) {
      // If the pattern is not found or not available (e.g. status: withdrawn/removed),
      // render a custom "Unavailable" page
      return new Response(getUnavailableHtml("Pattern"), {
        status: 404,
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    const pattern = await res.json() as any;

    const html = getPatternHtml(id, pattern);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  } catch {
    // If backend is unreachable or error occurs, default to simple redirect/OG page with basic info
    // so we don't break the user experience
    const html = getFallbackHtml(id, "Pattern");
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }
};

function getPatternHtml(id: string, pattern: any): string {
  const title = `Stitch Wish - ${pattern.title}`;
  const description = `Play '${pattern.title}' by ${pattern.creatorName} (${pattern.width}x${pattern.height}, ${pattern.paletteSize} colors) in Stitch Wish: Cross Stitch!`;
  const previewUrl = pattern.previewUrl || '';
  const appLink = `stitchwish://catalog/pattern/${id}`;
  const fallbackUrl = `/pattern/${id}?fallback=true`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${previewUrl}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://stitchwish.avkdesign.net/pattern/${id}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${previewUrl}">
  <meta name="viewport" content="width=device-width, initial-scale=device-width, initial-scale=1">
  <script>
    // Try to open deep link in native app
    window.location.replace("${appLink}");
    // If app is not installed, fallback to the web landing page after a delay
    setTimeout(function() {
      window.location.replace("${fallbackUrl}");
    }, 1500);
  </script>
</head>
<body>
  <p>Redirecting to Stitch Wish app... If the app does not open, <a href="${fallbackUrl}">click here to view in browser</a>.</p>
</body>
</html>`;
}

function getFallbackHtml(id: string, type: string): string {
  const title = `Stitch Wish - View ${type}`;
  const description = `Open this ${type.toLowerCase()} in Stitch Wish: Cross Stitch!`;
  const appLink = type === 'Pattern' ? `stitchwish://catalog/pattern/${id}` : `stitchwish://profile/${id}`;
  const fallbackUrl = type === 'Pattern' ? `/pattern/${id}?fallback=true` : `/profile/${id}?fallback=true`;

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

function getUnavailableHtml(type: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Content Unavailable - Stitch Wish</title>
  <meta name="viewport" content="width=device-width, initial-scale=device-width, initial-scale=1">
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
    <p>This ${type.toLowerCase()} is no longer available. It may have been withdrawn by its creator or removed by moderation.</p>
    <p><a href="/">Go to Home Page</a></p>
  </div>
</body>
</html>`;
}
