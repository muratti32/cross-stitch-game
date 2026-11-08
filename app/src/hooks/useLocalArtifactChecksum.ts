import { findLocalArtifactChecksum } from '../local-db/localArtifactChecksum';
import { useKeyedAsync } from './useKeyedAsync';

/** Checksum of a Pattern Artifact this device holds for the pattern (null: none, undefined: still looking). */
export function useLocalArtifactChecksum(patternId: string, enabled: boolean): string | null | undefined {
  const checksum = useKeyedAsync(enabled ? patternId : undefined, findLocalArtifactChecksum, null);
  return enabled ? checksum : null;
}
