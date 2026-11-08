import { Config } from '../config';

/** Catalog Share Link for a Pattern: the public id only, never a Pattern Artifact or grant. */
export function catalogShareLink(patternId: string): string {
  return `${Config.webBaseUrl}/pattern/${patternId}`;
}
