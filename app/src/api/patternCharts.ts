import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './apiFetch';
import { coinBalanceQueryKey, EconomyApiError } from './economy';
import { useIdentityStore } from '../identity/guestIdentity';
import { recordChartPurchaseResult } from '../analytics/patternChart';
import type { PatternUnlockTier } from '../analytics/schema';

/** Pattern Chart Entitlement queries (ADR-0068): server is authoritative for price and ownership. */
/** Prefix of every chart query; invalidating it refreshes each per-pattern access query. */
export const patternChartsQueryKey = ['economy', 'pattern-charts'] as const;
export const patternChartQueryKey = (patternId: string) => ['economy', 'pattern-charts', patternId] as const;

export type PatternChartErrorKind =
  | 'account_required'
  | 'not_found'
  | 'removed'
  | 'unavailable'
  | 'unlock_required'
  | 'price_changed'
  | 'insufficient_balance'
  | 'chart_required'
  | 'other';

export class PatternChartError extends EconomyApiError {
  constructor(
    status: number,
    readonly kind: PatternChartErrorKind,
    reason: string | null,
    readonly price: number | null = null,
    readonly balance: number | null = null,
  ) {
    super(status, reason ?? kind, reason);
    this.name = 'PatternChartError';
  }
}

interface ErrorBody {
  code?: unknown;
  reason?: unknown;
  price?: unknown;
  balance?: unknown;
}

function intOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

/** Safety Removal: the Pattern may no longer be drawn. */
export function isRemovedChartError(error: unknown): boolean {
  return error instanceof PatternChartError && error.kind === 'removed';
}

/** The cached access answer is stale: the price changed or the Pattern left the catalog. */
function isStaleAccessError(error: unknown): boolean {
  return error instanceof PatternChartError
    && (error.kind === 'price_changed' || error.kind === 'removed' || error.kind === 'unavailable');
}

/** Pure mapping of the backend contract's status + code to a typed error. */
export function mapPatternChartError(status: number, body: ErrorBody | null): PatternChartError {
  const codeValue = body?.code ?? body?.reason;
  const code = typeof codeValue === 'string' ? codeValue : null;
  const price = intOrNull(body?.price);
  const balance = intOrNull(body?.balance);
  if (status === 403 && code === 'account_required') return new PatternChartError(status, 'account_required', code);
  if (status === 403 && code === 'unlock_required') return new PatternChartError(status, 'unlock_required', code, price);
  if (status === 403 && code === 'pattern_chart_required') return new PatternChartError(status, 'chart_required', code);
  if (status === 404) return new PatternChartError(status, 'not_found', code);
  if (status === 410 && code === 'pattern_removed') return new PatternChartError(status, 'removed', code);
  if (status === 410) return new PatternChartError(status, 'unavailable', code ?? 'pattern_unavailable');
  if (status === 409 && code === 'pattern_chart_price_changed') return new PatternChartError(status, 'price_changed', code, price);
  if (status === 409 && code === 'insufficient_balance') return new PatternChartError(status, 'insufficient_balance', code, price, balance);
  return new PatternChartError(status, 'other', code);
}

async function toChartError(res: Response): Promise<PatternChartError> {
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  return mapPatternChartError(res.status, body);
}

/** Server pattern status: `withdrawn`/`review_hold` stop sales and fetches, `removed` stops drawing. */
export type PatternChartAvailability = 'available' | 'withdrawn' | 'review_hold' | 'removed';

export type PatternChartAccess =
  | { status: 'ineligible' }
  | { status: 'removed' }
  | { status: 'entitled'; price: number; availability: PatternChartAvailability }
  | { status: 'purchasable'; price: number; availability: PatternChartAvailability };

const AVAILABILITIES: readonly PatternChartAvailability[] = ['available', 'withdrawn', 'review_hold', 'removed'];

export async function fetchPatternChartAccess(patternId: string): Promise<PatternChartAccess> {
  const res = await apiFetch(`/v1/economy/pattern-charts/${encodeURIComponent(patternId)}`);
  if (res.status === 404) return { status: 'ineligible' };
  if (!res.ok) {
    const error = await toChartError(res);
    if (error.kind === 'removed') return { status: 'removed' };
    throw error;
  }
  const data = (await res.json().catch(() => null)) as { entitled?: unknown; price?: unknown; status?: unknown } | null;
  const price = intOrNull(data?.price);
  const availability = AVAILABILITIES.find((value) => value === data?.status);
  if (typeof data?.entitled !== 'boolean' || price === null || availability === undefined) {
    throw new PatternChartError(res.status, 'other', 'invalid_pattern_chart_response');
  }
  if (availability === 'removed') return { status: 'removed' };
  return { status: data.entitled ? 'entitled' : 'purchasable', price, availability };
}

export interface PatternChartPurchase {
  patternId: string;
  alreadyEntitled: boolean;
  price: number;
  /** Server-owned price tier, used as-is for analytics. */
  tier: PatternUnlockTier;
  balance: number;
}

const TIERS: readonly PatternUnlockTier[] = ['small', 'medium', 'large'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isPatternChartPurchase(value: unknown): value is PatternChartPurchase {
  return isRecord(value)
    && typeof value.patternId === 'string'
    && typeof value.alreadyEntitled === 'boolean'
    && intOrNull(value.price) !== null
    && intOrNull(value.balance) !== null
    && TIERS.some((tier) => tier === value.tier);
}

export async function purchasePatternChart(patternId: string, expectedPrice: number): Promise<PatternChartPurchase> {
  const res = await apiFetch('/v1/economy/pattern-charts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patternId, expectedPrice }),
  });
  if (!res.ok) throw await toChartError(res);
  const data: unknown = await res.json().catch(() => null);
  if (!isPatternChartPurchase(data)) {
    throw new PatternChartError(res.status, 'other', 'invalid_pattern_chart_response');
  }
  return data;
}

export interface PatternChartArtifactGrant {
  patternId: string;
  artifact: { byteLength: number; checksum: string; schemaVersion: number };
  grant: { url: string; expiresAt: string };
}

export function isPatternChartArtifactGrant(value: unknown): value is PatternChartArtifactGrant {
  if (!isRecord(value) || typeof value.patternId !== 'string') return false;
  const { artifact, grant } = value;
  return isRecord(artifact)
    && typeof artifact.checksum === 'string'
    && intOrNull(artifact.byteLength) !== null
    && intOrNull(artifact.schemaVersion) !== null
    && isRecord(grant)
    && typeof grant.url === 'string'
    && typeof grant.expiresAt === 'string';
}

/** Fetch permission for a Pattern Artifact without a Stitching Session. */
export async function requestPatternChartArtifactGrant(patternId: string): Promise<PatternChartArtifactGrant> {
  const res = await apiFetch(`/v1/economy/pattern-charts/${encodeURIComponent(patternId)}/artifact-grant`, {
    method: 'POST',
  });
  if (!res.ok) throw await toChartError(res);
  const data: unknown = await res.json().catch(() => null);
  if (!isPatternChartArtifactGrant(data)) {
    throw new PatternChartError(res.status, 'other', 'invalid_pattern_chart_response');
  }
  return data;
}

/** Account-only: a Guest never reaches the server for this (the endpoint answers 403). */
export function usePatternChartAccess(patternId: string, enabled = true) {
  const isAccount = useIdentityStore((state) => state.isAccount);
  return useQuery({
    queryKey: patternChartQueryKey(patternId),
    queryFn: () => fetchPatternChartAccess(patternId),
    enabled: enabled && isAccount,
    retry: false,
  });
}

export function usePurchasePatternChart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patternId, expectedPrice }: { patternId: string; expectedPrice: number }) =>
      purchasePatternChart(patternId, expectedPrice),
    onSuccess: (result) => {
      recordChartPurchaseResult(result);
      queryClient.invalidateQueries({ queryKey: coinBalanceQueryKey });
      queryClient.invalidateQueries({ queryKey: patternChartsQueryKey });
    },
    onError: (error, { patternId }) => {
      // A stale price or a pattern that left the catalog: refresh what the card shows.
      if (isStaleAccessError(error)) {
        void queryClient.invalidateQueries({ queryKey: patternChartQueryKey(patternId) });
      }
    },
  });
}
