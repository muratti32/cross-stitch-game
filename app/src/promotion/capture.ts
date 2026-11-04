import { isPostCommit } from './handoff';
import { handoffStore, type HandoffStore } from './handoffStore';
import { captureGuestRecords, type GuestCapture } from './manifest';

/**
 * Records the Promotion Handoff for a Guest that is about to become a
 * Registered Account. It must run while the Guest's Local Identity Namespace is
 * still the open one and before the session envelope is replaced, because after
 * the switch nothing connects the Guest's records to the account any more.
 *
 * A handoff that already passed its commit is never replaced: it still owns
 * unacknowledged items, and the backend consumed its Guest.
 */
export async function captureGuestPromotion(
  guestId: string,
  accountId: string,
  store: HandoffStore = handoffStore,
  read: (guestId: string) => Promise<GuestCapture> = captureGuestRecords,
): Promise<void> {
  const existing = await store.load();
  if (existing !== null && isPostCommit(existing)) return;
  const capture = await read(guestId);
  await store.save({ phase: 'captured', guestId, accountId, ...capture });
}
