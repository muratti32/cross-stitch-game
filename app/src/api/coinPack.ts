import { apiFetch } from './apiFetch';

export type CoinPackProductKey = 'coin_pack_300' | 'coin_pack_900' | 'coin_pack_2000';

export interface CoinPackReconciliationReference {
  id: string;
  supportReference: string;
}

export type CoinPackReconciliationStatus =
  | { status: 'pending'; balance: null }
  | { status: 'verification_failed'; balance: null }
  | { status: 'grant_failed'; balance: null }
  | { status: 'granted'; balance: number };

export async function createCoinPackReconciliation(
  productKey: CoinPackProductKey,
  transactionIdentifier: string,
): Promise<CoinPackReconciliationReference> {
  const response = await apiFetch('/v1/commerce/coin-packs/reconciliations', {
    method: 'POST',
    body: JSON.stringify({ productKey, transactionIdentifier }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Coin Pack verification could not be started: ${response.status}`);
  }
  return (await response.json()) as CoinPackReconciliationReference;
}

export async function fetchCoinPackReconciliation(
  id: string,
): Promise<CoinPackReconciliationStatus> {
  const response = await apiFetch(`/v1/commerce/coin-packs/reconciliations/${id}`);
  if (!response.ok) {
    throw new Error(`Coin Pack verification could not be read: ${response.status}`);
  }
  return (await response.json()) as CoinPackReconciliationStatus;
}
