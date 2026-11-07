import { useEffect, useRef } from 'react';
import { promotionRunner } from './promotionRuntime';
import type { PromotionRunner } from './promotionRunner';

/**
 * A focus reload misses sessions adopted while a screen stays focused, as when
 * the sync resumes on a cold start with the Play tab already showing. Every
 * handoff change is a point where a session may have landed.
 */
export function usePromotionSessionsRefresh(reload: () => void, runner: PromotionRunner = promotionRunner): void {
  const latestReload = useRef(reload);
  latestReload.current = reload;

  useEffect(() => {
    let seen = runner.getSnapshot().handoff;
    return runner.subscribe(() => {
      const current = runner.getSnapshot().handoff;
      if (current === seen) return;
      seen = current;
      latestReload.current();
    });
  }, [runner]);
}
