import { isCatalogPatternId, UNAVAILABLE_PATTERN_SEGMENT } from './catalogPatternId';

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
 * non-UUID id is routed to a fixed unavailable segment: the detail screen shows
 * its unavailable state, and the raw id never reaches a fetch or a route param.
 */
export function inboundPatternPath(url: string): string | null {
  const match = PATTERN_PATH.exec(inboundPathname(url));
  if (!match) return null;
  const id = match[1];
  return `/(tabs)/(catalog)/${isCatalogPatternId(id) ? id.toLowerCase() : UNAVAILABLE_PATTERN_SEGMENT}`;
}
