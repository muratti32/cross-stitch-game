import { UnlockableTier, unlockPriceForTier } from '@/api/economy';

import { captureGameplayEvent } from './gameplayEvents';

interface UnlockPromptDecision {
  isAuthenticated: boolean;
  unlocksLoaded: boolean;
  tier: UnlockableTier | null;
  owned: boolean;
  insufficientPanelOpen: boolean;
  alreadyPrompted: boolean;
}

interface UnlockResult {
  alreadyUnlocked: boolean;
}

export function shouldEmitUnlockPrompt(input: UnlockPromptDecision): boolean {
  return (
    input.isAuthenticated
    && input.unlocksLoaded
    && input.tier !== null
    && !input.owned
    && !input.insufficientPanelOpen
    && !input.alreadyPrompted
  );
}

export function unlockShortfall(price: number, balance: number): number | null {
  const shortfall = price - balance;
  return Number.isInteger(shortfall) && shortfall > 0 ? shortfall : null;
}

export function unlockPromptShown(tier: UnlockableTier, price: number): void {
  void captureGameplayEvent('unlock_prompt_shown', { tier, price });
}

export function patternUnlocked(tier: UnlockableTier, price: number): void {
  void captureGameplayEvent('pattern_unlocked', { tier, price });
}

export function recordUnlockResult(tier: UnlockableTier | null, result: UnlockResult): void {
  if (tier !== null && !result.alreadyUnlocked) {
    patternUnlocked(tier, unlockPriceForTier(tier));
  }
}

export function unlockInsufficientCoins(tier: UnlockableTier, shortfall: number): void {
  void captureGameplayEvent('unlock_insufficient_coins', { tier, shortfall });
}

export function unlockGetCoinsTapped(tier: UnlockableTier, shortfall: number): void {
  void captureGameplayEvent('unlock_get_coins_tapped', { tier, shortfall });
}
