const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATTERN_PATH = /^\/(?:catalog\/)?pattern\/([^/]+)\/?$/i;

/** Path of an inbound URL: `https://host/pattern/x` and `stitchwish://catalog/pattern/x` both reduce to it. */
function inboundPathname(url: string): string {
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
  let rest = schemeMatch ? url.slice(schemeMatch[0].length) : url;
  if (schemeMatch && /^https?$/i.test(schemeMatch[1])) {
    const slash = rest.indexOf('/');
    rest = slash === -1 ? '/' : rest.slice(slash);
  }
  rest = rest.split(/[?#]/)[0];
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/**
 * Maps an inbound Catalog Share Link to the in-app catalog detail path. A
 * non-UUID id is still routed to the detail screen, which then shows the
 * unavailable state (the backend rejects it) instead of an unmatched route.
 */
export function inboundPatternPath(url: string): string | null {
  const match = PATTERN_PATH.exec(inboundPathname(url));
  if (!match) return null;
  const id = match[1];
  return `/(tabs)/(catalog)/${UUID.test(id) ? id.toLowerCase() : encodeURIComponent(id)}`;
}
