import { inboundPatternPath } from '../src/navigation/inboundPatternPath';

/** Routes inbound Catalog Share Links to the in-app pattern detail screen. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return inboundPatternPath(path) ?? path;
}
