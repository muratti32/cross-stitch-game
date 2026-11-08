import { useEffect, useState } from 'react';
import { resolveSessionOfficial } from '../api/catalog';

/** Official flag for a local session: true/false once known, undefined while resolving or unknown. */
export function useSessionOfficial(session: { patternId: string; official?: boolean | null } | null | undefined): boolean | undefined {
  const patternId = session?.patternId;
  const recorded = session?.official;
  const [resolved, setResolved] = useState<{ patternId: string; official: boolean | null } | null>(null);
  useEffect(() => {
    if (!patternId || recorded === true || recorded === false) return;
    let cancelled = false;
    resolveSessionOfficial({ patternId, official: recorded })
      .then((official) => { if (!cancelled) setResolved({ patternId, official }); })
      .catch(() => { if (!cancelled) setResolved({ patternId, official: null }); });
    return () => { cancelled = true; };
  }, [patternId, recorded]);
  if (recorded === true || recorded === false) return recorded;
  return resolved !== null && resolved.patternId === patternId ? resolved.official ?? undefined : undefined;
}
