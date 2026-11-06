import type { DrainSessionResult, PackagedSession } from '../api/promotionContract';
import { adoptPromotedSession, getActiveIdentity } from '../local-db';
import { copyOfflinePatternToNamespace } from '../session-preparation';

/**
 * Brings a packaged session into the account namespace. The artifact goes first
 * so a row never exists without it: with no server session there is no grant to
 * re-download it from. The namespace check stops a sign-out during the sync from
 * writing account rows into whichever namespace opened next; the failure leaves
 * the session unacknowledged for its account to finish.
 */
export async function adoptPackagedSession(
  owners: { guestId: string; accountId: string },
  session: PackagedSession,
  server: DrainSessionResult | null,
): Promise<void> {
  if (getActiveIdentity() !== owners.accountId) {
    throw new Error('The account namespace is not open');
  }
  if (session.source !== 'bundled' && (server?.accountSessionId ?? null) === null) {
    await copyOfflinePatternToNamespace(session.patternId, owners.guestId, owners.accountId);
  }
  await adoptPromotedSession(session, server);
}
