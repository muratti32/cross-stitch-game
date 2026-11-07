import { updateSessionError } from '../local-db';
import { deleteOfflinePatternFile } from '../session-preparation';

const PATTERN_REMOVED_NOTE = 'This Community Pattern was removed by moderation.';

/**
 * Safety Removal deletion instruction: record the removal on the session and
 * wipe its Offline Pattern Data so it stays unavailable.
 */
export async function applyPatternRemoval(session: { id: string; patternId: string }): Promise<void> {
  await updateSessionError(session.id, PATTERN_REMOVED_NOTE);
  await deleteOfflinePatternFile(session.patternId).catch(() => undefined);
}
