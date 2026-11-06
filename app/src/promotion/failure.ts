import { isOfflineNetworkError } from '../api/networkErrors';
import { PromotionApiError } from '../api/promotionContract';

/**
 * What the player is told when a promotion request fails. Each key names a
 * localized string in the `promotion` namespace except `unexpected`, which
 * falls back to the shared generic failure with a Support Reference (ADR-0051).
 * The server's English `message` is never part of a failure.
 */
export type PromotionFailureKey =
  | 'network'
  | 'credentialRejected'
  | 'guestNotFound'
  | 'accountClosing'
  | 'unexpected';

export interface PromotionFailure {
  key: PromotionFailureKey;
  /** Present for a backend error the shared presenter can turn into a Support Reference. */
  cause: PromotionApiError | null;
}

export function classifyPromotionFailure(error: unknown): PromotionFailure {
  if (error instanceof PromotionApiError) {
    if (error.code === null) {
      if (error.status === 401) return { key: 'credentialRejected', cause: error };
      if (error.status === 404) return { key: 'guestNotFound', cause: error };
      if (error.status === 403) return { key: 'accountClosing', cause: error };
    }
    return { key: 'unexpected', cause: error };
  }
  if (isOfflineNetworkError(error)) return { key: 'network', cause: null };
  return { key: 'unexpected', cause: null };
}
