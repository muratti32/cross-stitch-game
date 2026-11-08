import { resolveSessionOfficial } from '../api/catalog';
import { useKeyedAsync } from './useKeyedAsync';

/** Official flag for a local session: true/false once known, undefined while resolving or unknown. */
export function useSessionOfficial(session: { patternId: string; official?: boolean | null } | null | undefined): boolean | undefined {
  const patternId = session?.patternId;
  const recorded = session?.official;
  const isRecorded = recorded === true || recorded === false;
  const resolved = useKeyedAsync(
    patternId && !isRecorded ? patternId : undefined,
    (id) => resolveSessionOfficial({ patternId: id, official: recorded }),
    null,
  );
  if (isRecorded) return recorded;
  return resolved ?? undefined;
}
