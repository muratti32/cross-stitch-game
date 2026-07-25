import {
  getUnackedAnalyticsGameplayEvents,
  markAnalyticsGameplayEventsAcked,
} from '../local-db';
import {
  GameplayEventSyncError,
  postAnalyticsGameplayEvents,
} from '../api/gameplayEvents';

// The backend accepts no more than 500 events per DTO, so every upload uses
// that cap. Local storage retains at most 2,000 analytics events (enforced by
// local-db) because analytics is not a reward or progress authority.
const FLUSH_BATCH_LIMIT = 500;

/**
 * A status the backend will return again for the same bytes no matter how often
 * we retry: the batch is malformed or too large for the ingest schema. Auth
 * failures (401/403) and rate limiting (429) are deliberately absent - those do
 * succeed on a later attempt, so they must keep retrying.
 */
function isPermanentRejection(error: unknown): boolean {
  return (
    error instanceof GameplayEventSyncError &&
    (error.status === 400 || error.status === 413 || error.status === 422)
  );
}

/**
 * Delivers persisted analytics events in order. Events remain in SQLite until
 * the #60 endpoint accepts the entire batch, making transient/offline retries
 * safe with the event ids created at capture time.
 */
export async function flushAnalyticsGameplayEvents(): Promise<void> {
  let queued = await getUnackedAnalyticsGameplayEvents(FLUSH_BATCH_LIMIT);
  while (queued.length > 0) {
    try {
      await postAnalyticsGameplayEvents(queued);
    } catch (error: unknown) {
      // A batch the server will never accept has to leave the queue, or it sits
      // at the head forever and silently kills the whole analytics stream. These
      // events are dropped on purpose - strictly better than losing every event
      // recorded after them.
      if (!isPermanentRejection(error)) {
        throw error;
      }
    }
    await markAnalyticsGameplayEventsAcked(queued.map((event) => event.eventId));
    if (queued.length < FLUSH_BATCH_LIMIT) {
      return;
    }
    queued = await getUnackedAnalyticsGameplayEvents(FLUSH_BATCH_LIMIT);
  }
}
