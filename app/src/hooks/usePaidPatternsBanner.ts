import { useCallback, useEffect, useState } from 'react';

import { hasSeenPaidPatternsBanner, markPaidPatternsBannerSeen } from '@/local-db';
import { captureLocalPersistenceError } from '@/observability/sentry';

export function usePaidPatternsBanner(hasPaidPattern: boolean) {
  const [hasLoaded, setHasLoaded] = useState(false);
  const [seen, setSeen] = useState(true);

  useEffect(() => {
    let active = true;
    void hasSeenPaidPatternsBanner()
      .then((value) => {
        if (active) setSeen(value);
      })
      .catch(() => {
        if (active) setSeen(true);
      })
      .finally(() => {
        if (active) setHasLoaded(true);
      });
    return () => { active = false; };
  }, []);

  const dismiss = useCallback(() => {
    setSeen(true);
    void markPaidPatternsBannerSeen().catch((error: unknown) => {
      captureLocalPersistenceError('mark-paid-patterns-banner-seen', error);
    });
  }, []);

  return { visible: hasLoaded && !seen && hasPaidPattern, dismiss };
}
