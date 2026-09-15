import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './apiFetch';

export const coinBalanceQueryKey = ['economy', 'balance'] as const;
export const rewardDayQueryKey = ['economy', 'reward-day'] as const;

// Unlock prices are fixed by ADR-0011 by tier.
// Note: the server remains authoritative on the actual charge.
export const UNLOCK_PRICE_COIN = {
  small: 75,
  medium: 150,
  large: 300,
} as const;

export type UnlockableTier = 'small' | 'medium' | 'large';

export function unlockPriceForTier(tier: UnlockableTier): number {
  return UNLOCK_PRICE_COIN[tier];
}

export class InsufficientCoinError extends Error {
  constructor(readonly price: number, readonly balance: number) {
    super('insufficient_balance');
    this.name = 'InsufficientCoinError';
  }
}

// #159/#166: shaped like CreatorProfileApiError, SocialApiError, and
// CatalogSubmissionApiError (06c8eb0) so a caught economy failure routes
// through localizeServerError instead of the server's raw English message.
export class EconomyApiError extends Error {
  constructor(readonly status: number, message: string, readonly reason: string | null) {
    super(message);
    this.name = 'EconomyApiError';
  }
}

export class LocatorInsufficientBalanceError extends EconomyApiError {
  constructor(readonly price: number, readonly balance: number) {
    super(409, 'insufficient_balance', 'insufficient_balance');
    this.name = 'LocatorInsufficientBalanceError';
  }
}

export class LocatorPriceChangedError extends EconomyApiError {
  constructor(readonly price: number, readonly balance: number) {
    super(409, 'locator_price_changed', 'locator_price_changed');
    this.name = 'LocatorPriceChangedError';
  }
}

// ADR-0060: the server could not serve a Locator Price, so the locator must not
// reserve. Shaped as a backend failure so it reaches Sentry with a Support Reference.
export class LocatorPriceUnavailableError extends EconomyApiError {
  constructor() {
    super(503, 'locator_price_unavailable', 'locator_price_unavailable');
    this.name = 'LocatorPriceUnavailableError';
  }
}

export interface CoinBalanceView {
  balance: number;
  /** Current operator-managed Locator Price; null when the server cannot provide it (ADR-0060). */
  locatorPrice: number | null;
}

export interface LocatorAttemptView {
  attemptId: string;
  status: 'prepared' | 'committed' | 'released' | 'expired' | 'rejected';
  price: number;
  balance: number;
  expiresAt: string;
  targetCellIndex: number | null;
}

export interface PrepareLocatorAttemptInput {
  attemptId: string;
  sessionId: string;
  patternId: string;
  colorIndex: number;
  dmcCode: string;
  /** The Locator Price shown to the player; the server rejects a stale value without charge. */
  expectedPrice: number;
  progressRevision?: number;
  progressHash?: string;
}

export interface CommitLocatorAttemptInput {
  targetCellIndex: number;
  progressRevision?: number;
  progressHash?: string;
}

async function parseEconomyError(response: Response, fallback: string): Promise<EconomyApiError> {
  let message = fallback;
  let reason: string | null = null;
  try {
    const body = (await response.json()) as { message?: unknown; reason?: unknown };
    if (typeof body.message === 'string') message = body.message;
    if (Array.isArray(body.message)) {
      message = body.message.filter((item): item is string => typeof item === 'string').join(', ');
    }
    if (typeof body.reason === 'string') reason = body.reason;
  } catch {
    // Keep the actionable fallback.
  }
  return new EconomyApiError(response.status, message, reason);
}

export interface UnlockResult {
  patternId: string;
  alreadyUnlocked: boolean;
  balance: number;
}

export async function unlockPattern(patternId: string): Promise<UnlockResult> {
  const res = await apiFetch('/v1/economy/unlocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patternId }),
  });

  if (res.status === 409) {
    const data = await res.json().catch(() => null);
    const price = data?.price ?? 0;
    const balance = data?.balance ?? 0;
    throw new InsufficientCoinError(price, balance);
  }

  if (!res.ok) {
    throw await parseEconomyError(res, 'Unlock failed: ' + res.status);
  }

  return (await res.json()) as UnlockResult;
}

export async function fetchCoinBalanceView(): Promise<CoinBalanceView> {
  const res = await apiFetch('/v1/economy/balance');
  if (!res.ok) {
    throw await parseEconomyError(res, 'Failed to fetch coin balance: ' + res.status);
  }
  const data = (await res.json().catch(() => null)) as { balance?: unknown; locatorPrice?: unknown } | null;
  if (typeof data?.balance !== 'number' || !Number.isSafeInteger(data.balance)) {
    throw new EconomyApiError(res.status, 'invalid_balance_response', 'invalid_balance_response');
  }
  const locatorPrice = typeof data.locatorPrice === 'number' && Number.isSafeInteger(data.locatorPrice) && data.locatorPrice > 0
    ? data.locatorPrice
    : null;
  return { balance: data.balance, locatorPrice };
}

export async function fetchCoinBalance(): Promise<number> {
  return (await fetchCoinBalanceView()).balance;
}

async function parseLocatorResult(res: Response): Promise<LocatorAttemptView> {
  if (res.status === 409) {
    const data = await res.json().catch(() => null) as { code?: unknown; price?: unknown; balance?: unknown } | null;
    const code = typeof data?.code === 'string' ? data.code : null;
    const price = typeof data?.price === 'number' ? data.price : null;
    const balance = typeof data?.balance === 'number' ? data.balance : null;
    // A conflict missing its price or balance is surfaced as a generic
    // failure rather than showing the player an invented amount.
    if (code === 'locator_price_changed' && price !== null && balance !== null) {
      throw new LocatorPriceChangedError(price, balance);
    }
    if (code === 'insufficient_balance' && price !== null && balance !== null) {
      throw new LocatorInsufficientBalanceError(price, balance);
    }
    if (code !== null) {
      throw new EconomyApiError(409, code, code);
    }
  }
  if (!res.ok) throw await parseEconomyError(res, 'Locator attempt failed: ' + res.status);
  return (await res.json()) as LocatorAttemptView;
}

export async function prepareLocatorAttempt(input: PrepareLocatorAttemptInput, signal?: AbortSignal): Promise<LocatorAttemptView> {
  const res = await apiFetch('/v1/economy/locator-attempts/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(input),
  });
  return parseLocatorResult(res);
}

export async function commitLocatorAttempt(attemptId: string, input: CommitLocatorAttemptInput, signal?: AbortSignal): Promise<LocatorAttemptView> {
  const res = await apiFetch(`/v1/economy/locator-attempts/${encodeURIComponent(attemptId)}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(input),
  });
  return parseLocatorResult(res);
}

export async function releaseLocatorAttempt(
  attemptId: string,
  input: { cancellation?: boolean } = { cancellation: true },
): Promise<LocatorAttemptView> {
  const res = await apiFetch(`/v1/economy/locator-attempts/${encodeURIComponent(attemptId)}/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseLocatorResult(res);
}

export async function fetchLocatorAttempt(attemptId: string): Promise<LocatorAttemptView> {
  const res = await apiFetch(`/v1/economy/locator-attempts/${encodeURIComponent(attemptId)}`);
  return parseLocatorResult(res);
}

export async function fetchUnlockedPatternIds(): Promise<string[]> {
  const res = await apiFetch('/v1/economy/unlocks');
  if (!res.ok) {
    throw await parseEconomyError(res, 'Failed to fetch unlocked patterns: ' + res.status);
  }
  const data = (await res.json()) as { patternIds: string[] };
  return data.patternIds;
}

export function useCoinBalance() {
  return useQuery({
    queryKey: coinBalanceQueryKey,
    queryFn: fetchCoinBalanceView,
    select: (view: CoinBalanceView) => view.balance,
  });
}

/** Shares the balance query so the locator button shows the price last served with the balance. */
export function useLocatorPrice() {
  return useQuery({
    queryKey: coinBalanceQueryKey,
    queryFn: fetchCoinBalanceView,
    select: (view: CoinBalanceView) => view.locatorPrice,
  });
}

export function useUnlockedPatternIds() {
  return useQuery({
    queryKey: ['economy', 'unlocks'],
    queryFn: fetchUnlockedPatternIds,
  });
}

export function useUnlockPattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unlockPattern,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: coinBalanceQueryKey });
      queryClient.invalidateQueries({ queryKey: ['economy', 'unlocks'] });
    },
  });
}

export interface RewardDayView {
  balance: number;
  adsRemaining: number;
  coinsRemaining: number;
  resetsAt: string;
  premiumClaimed: boolean;
}

export async function fetchRewardDay(): Promise<RewardDayView> {
  const res = await apiFetch('/v1/economy/reward-day');
  if (!res.ok) {
    throw await parseEconomyError(res, 'Failed to fetch reward day: ' + res.status);
  }
  return (await res.json()) as RewardDayView;
}

export function useRewardDay() {
  return useQuery({
    queryKey: rewardDayQueryKey,
    queryFn: fetchRewardDay,
  });
}

export interface AdAttempt {
  nonce: string;
  expiresAt: string;
  /** Missing only from old backends; safely selects the legacy client-claim path. */
  ssvActive: boolean | undefined;
}

export interface AdAttemptState {
  state: 'pending' | 'verified' | 'expired';
  expiresAt: string;
}

export async function fetchAdAttemptState(nonce: string): Promise<AdAttemptState> {
  const res = await apiFetch(`/v1/economy/ad-attempts/${encodeURIComponent(nonce)}`);
  if (!res.ok) throw await parseEconomyError(res, `Failed to fetch ad attempt: ${res.status}`);
  return (await res.json()) as AdAttemptState;
}

export async function openAdAttempt(): Promise<AdAttempt> {
  const res = await apiFetch('/v1/economy/ad-attempts', {
    method: 'POST',
  });
  if (!res.ok) {
    throw await parseEconomyError(res, 'Failed to open ad attempt: ' + res.status);
  }
  return (await res.json()) as AdAttempt;
}

export function useOpenAdAttempt() {
  return useMutation({
    mutationFn: openAdAttempt,
  });
}

export interface AdRewardGrantResult {
  granted: boolean;
  amount: number;
  balance: number;
  adsCompleted: number;
  coinsConsumed: number;
  replayed: boolean;
}

export async function claimAdReward(nonce: string): Promise<AdRewardGrantResult> {
  const res = await apiFetch('/v1/economy/ad-attempts/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce }),
  });
  if (!res.ok) {
    throw await parseEconomyError(res, `HTTP ${res.status}`);
  }
  return (await res.json()) as AdRewardGrantResult;
}

export function useClaimAdReward() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: claimAdReward,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: coinBalanceQueryKey });
      queryClient.invalidateQueries({ queryKey: rewardDayQueryKey });
    },
  });
}
