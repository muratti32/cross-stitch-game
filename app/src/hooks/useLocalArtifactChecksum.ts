import { useEffect, useState } from 'react';
import { findLocalArtifactChecksum } from '../pattern-chart/chartPatternDeps';

/** Checksum of a Pattern Artifact this device holds for the pattern (null: none, undefined: still looking). */
export function useLocalArtifactChecksum(patternId: string, enabled: boolean): string | null | undefined {
  const [state, setState] = useState<{ patternId: string; checksum: string | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    findLocalArtifactChecksum(patternId)
      .then((checksum) => { if (!cancelled) setState({ patternId, checksum }); })
      .catch(() => { if (!cancelled) setState({ patternId, checksum: null }); });
    return () => { cancelled = true; };
  }, [patternId, enabled]);
  if (!enabled) return null;
  return state?.patternId === patternId ? state.checksum : undefined;
}
