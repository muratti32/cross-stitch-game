import * as SecureStore from 'expo-secure-store';

interface StoredGuestPurchaseAttempt {
  id: string;
  productKey: string;
  supportReference: string;
}

function key(guestId: string): string {
  return `stitch_wish.guest_purchase_attempt.${guestId}`;
}

export async function saveGuestPurchaseAttempt(
  guestId: string,
  attempt: StoredGuestPurchaseAttempt,
): Promise<void> {
  await SecureStore.setItemAsync(key(guestId), JSON.stringify(attempt));
}

export async function readGuestPurchaseAttempt(
  guestId: string,
): Promise<StoredGuestPurchaseAttempt | null> {
  const raw = await SecureStore.getItemAsync(key(guestId));
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    return typeof record.id === 'string'
      && typeof record.productKey === 'string'
      && typeof record.supportReference === 'string'
      ? { id: record.id, productKey: record.productKey, supportReference: record.supportReference }
      : null;
  } catch {
    return null;
  }
}

export async function clearGuestPurchaseAttempt(guestId: string): Promise<void> {
  await SecureStore.deleteItemAsync(key(guestId));
}
