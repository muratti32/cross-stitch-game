import { useEffect, useRef, useState } from 'react';

/**
 * Resolves `load(key)` once per key. Returns undefined until the load settles for the
 * current key; a rejected load settles to `fallback` (the caller's "unknown" value).
 * Results for a previous key are never returned. `load` may change between renders
 * without restarting the request.
 */
export function useKeyedAsync<T>(
  key: string | undefined,
  load: (key: string) => Promise<T>,
  fallback: T,
): T | undefined {
  const [settled, setSettled] = useState<{ key: string; value: T } | null>(null);
  const latest = useRef({ load, fallback });
  latest.current = { load, fallback };
  useEffect(() => {
    if (key === undefined) return;
    let cancelled = false;
    latest.current.load(key)
      .then((value) => { if (!cancelled) setSettled({ key, value }); })
      .catch(() => { if (!cancelled) setSettled({ key, value: latest.current.fallback }); });
    return () => { cancelled = true; };
  }, [key]);
  return key !== undefined && settled?.key === key ? settled.value : undefined;
}
