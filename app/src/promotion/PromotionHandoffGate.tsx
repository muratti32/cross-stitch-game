import { useEffect, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';
import { WebLinks } from '../config';
import { useIdentityStore } from '../identity/guestIdentity';
import { PromotionHandoffView } from './PromotionHandoffView';
import { promotionRunner } from './promotionRuntime';
import type { PromotionRunner } from './promotionRunner';

/**
 * Mounted once under the root layout. It resumes whatever Promotion Handoff is
 * stored for the signed-in account and renders the flow the runner reports.
 */
export function PromotionHandoffGate({ runner = promotionRunner }: { runner?: PromotionRunner }) {
  const accountId = useIdentityStore((state) => state.accountId);
  const isAuthenticated = useIdentityStore((state) => state.isAuthenticated);
  const snapshot = useSyncExternalStore(runner.subscribe, runner.getSnapshot);

  useEffect(() => {
    if (accountId && isAuthenticated) void runner.resume(accountId);
  }, [accountId, isAuthenticated, runner]);

  return (
    <PromotionHandoffView
      snapshot={snapshot}
      onConfirm={() => void runner.confirm()}
      onCancel={() => void runner.cancel()}
      onRetry={() => void runner.retry()}
      onContactSupport={() => void Linking.openURL(WebLinks.support)}
    />
  );
}
