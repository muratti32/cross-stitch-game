import { getUnackedGameplayEvents, markGameplayEventsAcked } from '../local-db';
import { postGameplayEvents } from '../api/dailyTasks';

const FLUSH_BATCH_LIMIT = 500;

/**
 * Uploads all locally-queued Gameplay Events to the Daily Tasks endpoint in
 * batches of at most 500 (DTO ArrayMaxSize cap), deleting each batch locally
 * only after a successful (201) response. Throws on failure so the caller can
 * decide how to handle retry — events remain queued locally either way since
 * they are only deleted after success.
 */
export async function flushGameplayEvents(): Promise<void> {
  let queued = await getUnackedGameplayEvents(FLUSH_BATCH_LIMIT);
  while (queued.length > 0) {
    await postGameplayEvents(
      queued.map((event) => ({
        eventId: event.eventId,
        kind: event.kind,
        sessionId: event.sessionId,
        dmcCode: event.dmcCode,
        clientSeq: event.clientSeq,
        occurredAt: event.occurredAt,
      })),
    );
    await markGameplayEventsAcked(queued.map((event) => event.eventId));
    if (queued.length < FLUSH_BATCH_LIMIT) break;
    queued = await getUnackedGameplayEvents(FLUSH_BATCH_LIMIT);
  }
}
