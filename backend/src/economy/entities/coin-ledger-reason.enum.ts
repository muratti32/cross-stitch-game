/**
 * Why a coin ledger entry was written. Each reason must also be allowed by the
 * `CHK_coin_ledger_entries_reason` migration check. The remaining movements
 * (daily tasks, unlock spend, packs, promotion, reversals) are added with their
 * own phases and widen that check as they land.
 */
export enum CoinLedgerReason {
  AdReward = 'ad_reward',
  FirstCompletion = 'first_completion',
  UnlockSpend = 'unlock_spend',
}
