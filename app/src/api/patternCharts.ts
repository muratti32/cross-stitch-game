import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './apiFetch';
import { coinBalanceQueryKey, EconomyApiError } from './economy';
import { useIdentityStore } from '../identity/guestIdentity';
import { recordChartPurchaseResult } from '../analytics/patternChart';

/** Pattern Chart Entitlement queries (ADR-0068): server is authoritative for price and ownership. */
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

async function failure(res: Response): Promise<PatternChartError> {
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  return mapPatternChartError(res.status, body);
}

export type PatternChartAccess =
  | { status: 'ineligible' }
  | { status: 'entitled'; price: number }
  | { status: 'purchasable'; price: number };

export async function fetchPatternChartAccess(patternId: string): Promise<PatternChartAccess> {
  const res = await apiFetch(`/v1/economy/pattern-charts/${encodeURIComponent(patternId)}`);
  if (res.status === 404) return { status: 'ineligible' };
  if (!res.ok) throw await failure(res);
  const data = (await res.json().catch(() => null)) as { entitled?: unknown; price?: unknown } | null;
  const price = intOrNull(data?.price);
  if (typeof data?.entitled !== 'boolean' || price === null) {
    throw new PatternChartError(res.status, 'other', 'invalid_pattern_chart_response');
  }
  return data.entitled ? { status: 'entitled', price } : { status: 'purchasable', price };
}

export interface PatternChartPurchase {
  patternId: string;
  alreadyEntitled: boolean;
  price: number;
  balance: number;
}

export async function purchasePatternChart(patternId: string, expectedPrice: number): Promise<PatternChartPurchase> {
  const res = await apiFetch('/v1/economy/pattern-charts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patternId, expectedPrice }),
  });
  if (!res.ok) throw await failure(res);
  const data = (await res.json().catch(() => null)) as Partial<PatternChartPurchase> | null;
  if (
    typeof data?.alreadyEntitled !== 'boolean'
    || intOrNull(data.price) === null
    || intOrNull(data.balance) === null
    || typeof data.patternId !== 'string'
  ) {
    throw new PatternChartError(res.status, 'other', 'invalid_pattern_chart_response');
  }
  return data as PatternChartPurchase;
}

export interface PatternChartArtifactGrant {
  patternId: string;
  artifact: { byteLength: number; checksum: string; schemaVersion: number };
  grant: { url: string; expiresAt: string };
}

/** Fetch permission for a Pattern Artifact without a Stitching Session. */
export async function requestPatternChartArtifactGrant(patternId: string): Promise<PatternChartArtifactGrant> {
  const res = await apiFetch(`/v1/economy/pattern-charts/${encodeURIComponent(patternId)}/artifact-grant`, {
    method: 'POST',
  });
  if (!res.ok) throw await failure(res);
  const data = (await res.json().catch(() => null)) as Partial<PatternChartArtifactGrant> | null;
  if (
    typeof data?.grant?.url !== 'string'
    || typeof data.artifact?.checksum !== 'string'
    || typeof data.artifact.byteLength !== 'number'
  ) {
    throw new PatternChartError(res.status, 'other', 'invalid_pattern_chart_response');
  }
  return data as PatternChartArtifactGrant;
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
      if (error instanceof PatternChartError && (error.kind === 'price_changed' || error.kind === 'removed' || error.kind === 'unavailable')) {
        void queryClient.invalidateQueries({ queryKey: patternChartQueryKey(patternId) });
      }
    },
  });
}
