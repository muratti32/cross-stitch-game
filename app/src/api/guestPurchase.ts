import { apiFetch } from './apiFetch';

export interface GuestPurchaseAttemptReference {
  id: string;
  status: 'created' | 'verifying' | 'granted' | 'failed' | 'cancelled';
  productId: string;
  supportReference: string;
  providerTransactionId: string | null;
}

/**
 * Guest commerce can be switched off operationally (ADR capability rollback).
 * The Game Backend answers every new Guest commerce write with 403 while it is
 * disabled, and the player must read that as a temporary outage rather than a
 * raw status code or an operator-facing configuration hint.
 */
const GUEST_COMMERCE_DISABLED_MESSAGE =
  'Purchases are temporarily unavailable. Please try again later.';

function guestCommerceError(action: string, status: number): Error {
  return new Error(status === 403 ? GUEST_COMMERCE_DISABLED_MESSAGE : `${action}: ${status}`);
}

export async function mapGuestRevenueCatSubscriber(subscriberId: string): Promise<void> {
  const response = await apiFetch('/v1/commerce/guest/revenuecat-mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'StitchWish/iOS' },
    body: JSON.stringify({ subscriberId }),
  });
  if (!response.ok) throw guestCommerceError('Guest commerce mapping failed', response.status);
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
  if (!response.ok) throw guestCommerceError('Guest purchase could not be prepared', response.status);
  return (await response.json()) as GuestPurchaseAttemptReference;
}

export async function fetchGuestPurchaseAttempt(id: string): Promise<GuestPurchaseAttemptReference> {
  const response = await apiFetch(`/v1/commerce/guest/purchase-attempts/${id}`);
  if (!response.ok) throw new Error(`Guest purchase status could not be read: ${response.status}`);
  return (await response.json()) as GuestPurchaseAttemptReference;
}

export async function cancelGuestPurchaseAttempt(id: string): Promise<GuestPurchaseAttemptReference> {
  const response = await apiFetch(`/v1/commerce/guest/purchase-attempts/${id}/cancel`, {
    method: 'POST',
  });
  if (!response.ok) throw guestCommerceError('Guest purchase could not be cancelled', response.status);
  return (await response.json()) as GuestPurchaseAttemptReference;
}
