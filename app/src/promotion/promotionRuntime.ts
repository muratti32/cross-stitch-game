import * as SecureStore from 'expo-secure-store';
import {
  cancelPromotion,
  commitPromotion,
  drainLike,
  drainSession,
  fetchPromotionPreview,
  lockPromotion,
  stagePromotionPackage,
} from '../api/promotion';
import { continueAsGuest } from '../identity/guestIdentity';
import { setLocalPatternLike } from '../local-db';
import { queryClient } from '../providers';
import { handoffStore } from './handoffStore';
import { createPromotionRunner } from './promotionRunner';
import { adoptPackagedSession } from './sessionAdoption';

const CREDENTIAL_SECRET_KEY = 'stitch_wish.credential_secret';

/** Automatic retry rounds after the first sync attempt, then Promotion Needs Attention. */
export const SYNC_BACKOFF_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000, 60_000];

/** The app's one Guest Data Promotion flow, driven from the root layout. */
export const promotionRunner = createPromotionRunner({
  store: handoffStore,
  api: { cancelPromotion, commitPromotion, drainLike, drainSession, fetchPromotionPreview, lockPromotion, stagePromotionPackage },
  readCredentialSecret: () => SecureStore.getItemAsync(CREDENTIAL_SECRET_KEY),
  // The Like now belongs to the signed-in account, so it is recorded in the
  // namespace that is open, not cleared from it.
  markLikeInAccountNamespace: (patternId) => setLocalPatternLike(patternId, true),
  adoptSession: adoptPackagedSession,
  returnToGuest: continueAsGuest,
  onEconomyChanged: () => {
    void queryClient.invalidateQueries({ queryKey: ['economy'] });
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  syncBackoffMs: SYNC_BACKOFF_MS,
});
