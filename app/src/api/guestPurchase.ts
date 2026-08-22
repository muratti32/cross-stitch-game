import { apiFetch } from './apiFetch';

export interface GuestPurchaseAttemptReference {
  id: string;
  status: 'created' | 'verifying' | 'granted' | 'failed' | 'cancelled';
  productId: string;
  supportReference: string;
  providerTransactionId: string | null;
}

export async function mapGuestRevenueCatSubscriber(subscriberId: string): Promise<void> {
  const response = await apiFetch('/v1/commerce/guest/revenuecat-mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'StitchWish/iOS' },
    body: JSON.stringify({ subscriberId }),
  });
  if (!response.ok) throw new Error(`Guest commerce mapping failed: ${response.status}`);
}

export async function createGuestPurchaseAttempt(
  productId: string,
  idempotencyKey: string,
  subscriberId: string,
): Promise<GuestPurchaseAttemptReference> {
  const response = await apiFetch('/v1/commerce/guest/purchase-attempts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'StitchWish/iOS' },
    body: JSON.stringify({ productId, idempotencyKey, subscriberId }),
  });
  if (!response.ok) throw new Error(`Guest purchase could not be prepared: ${response.status}`);
  return (await response.json()) as GuestPurchaseAttemptReference;
}

export async function fetchGuestPurchaseAttempt(id: string): Promise<GuestPurchaseAttemptReference> {
  const response = await apiFetch(`/v1/commerce/guest/purchase-attempts/${id}`);
  if (!response.ok) throw new Error(`Guest purchase status could not be read: ${response.status}`);
  return (await response.json()) as GuestPurchaseAttemptReference;
}
