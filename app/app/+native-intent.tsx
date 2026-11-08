import { inboundPatternPath } from '../src/navigation/inboundPatternPath';

/**
 * Routes inbound Catalog Share Links to the in-app pattern detail screen.
 *
 * expo-router@57.0.16 hands this hook the raw inbound URL:
 * build/getLinkingConfig.js:72 (initial URL) and build/link/linking.js:120
 * (subsequent URLs) both pass it as `path` with no pre-parsing. A throw here
 * would break link handling, so any failure falls back to the untouched path.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return inboundPatternPath(path) ?? path;
  } catch {
    return path;
  }
}
