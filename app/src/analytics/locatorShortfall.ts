import { captureGameplayEvent } from './gameplayEvents';

export function locatorCoinShortfallShown(price: number, balance: number): void {
  void captureGameplayEvent('locator_coin_shortfall_shown', { price, balance });
}

export function locatorCoinShortfallCtaPressed(price: number, balance: number): void {
  void captureGameplayEvent('locator_coin_shortfall_cta_pressed', { price, balance });
}
