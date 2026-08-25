import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import type { IngestGameplayEventDto } from './dto';
import {
  type GameplayEventKind,
  type GameplayEventPayload,
  validateGameplayEventPayload,
} from './events.schema';
import { EventsPartitionService } from './events-partition.service';

type NormalizedGameplayEvent = {
  eventId: string;
  occurredAt: Date;
  kind: GameplayEventKind;
  payload: GameplayEventPayload;
};

type EventIdRow = { event_id: string };

export type IngestGameplayEventsResult = {
  accepted: true;
  receivedCount: number;
  insertedCount: number;
};

export type GameplayEventDailyCount = {
  day: string;
  kind: GameplayEventKind;
  count: number;
};

type DailyCountRow = {
  day: string;
  kind: GameplayEventKind;
  count: string;
};

@Injectable()
export class EventsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly partitions: EventsPartitionService,
  ) {}

  // Only the principal's identity reaches the row, so a server-side emitter
  // that owns no session can supply one without inventing token state.
  async ingest(
    principal: Pick<AuthPrincipal, 'id' | 'type'>,
    incomingEvents: readonly IngestGameplayEventDto[],
  ): Promise<IngestGameplayEventsResult> {
    const now = new Date();
    const earliestRetainedMonth = this.partitions.earliestRetainedMonth(now);
    const events = dedupe(
      incomingEvents.map((event) =>
        normalizeEvent(event, now, earliestRetainedMonth),
      ),
    );
    if (events.length === 0) {
      return { accepted: true, receivedCount: 0, insertedCount: 0 };
    }

    // Only months that survived the occurredAt window check above are ever
    // provisioned, so a client cannot make the backend create arbitrary
    // partitions by claiming an event happened in some far-off month.
    await this.partitions.ensureMonths(events.map((event) => event.occurredAt));

    // (event_id, occurred_at) is the primary key, so the conflict clause is the
    // whole idempotency story: a retried batch replays identical rows and lands
    // nowhere. Deliberately no separate event-id registry table - an unpartitioned
    // one would grow forever and defeat the bounded retention this module exists
    // to guarantee.
    const insertedRows = await this.dataSource.query<EventIdRow[]>(
      `INSERT INTO analytics.gameplay_events
         (event_id, occurred_at, principal_type, principal_id, kind, payload)
       SELECT event_id, occurred_at, $2, $3, kind, payload
       FROM jsonb_to_recordset($1::jsonb) AS input(
         event_id uuid,
         occurred_at timestamptz,
         kind varchar,
         payload jsonb
       )
       ON CONFLICT (event_id, occurred_at) DO NOTHING
       RETURNING event_id`,
      [
        JSON.stringify(
          events.map((event) => ({
            event_id: event.eventId,
            occurred_at: event.occurredAt.toISOString(),
            kind: event.kind,
            payload: event.payload,
          })),
        ),
        principal.type,
        principal.id,
      ],
    );

    return {
      accepted: true,
      receivedCount: events.length,
      insertedCount: insertedRows.length,
    };
  }

  async countByKindPerDay(
    from: Date,
    toExclusive: Date,
  ): Promise<readonly GameplayEventDailyCount[]> {
    if (!isValidDate(from) || !isValidDate(toExclusive) || from >= toExclusive) {
      throw new BadRequestException('A valid ascending date range is required');
    }
    const rows = await this.dataSource.query<DailyCountRow[]>(
      `SELECT date_trunc('day', occurred_at)::date::text AS day,
              kind,
              count(*)::text AS count
       FROM analytics.gameplay_events
       WHERE occurred_at >= $1 AND occurred_at < $2
       GROUP BY 1, 2
       ORDER BY 1 ASC, 2 ASC`,
      [from.toISOString(), toExclusive.toISOString()],
    );
    return rows.map((row) => ({
      day: row.day,
      kind: row.kind,
      count: Number(row.count),
    }));
  }
}

// A queued offline batch legitimately arrives late, and a client clock can run a
// little fast, but an occurrence timestamp outside the retained range is either a
// broken clock or an attempt to steer partition creation.
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

function normalizeEvent(
  event: IngestGameplayEventDto,
  now: Date,
  earliestRetainedMonth: Date,
): NormalizedGameplayEvent {
  const occurredAt = new Date(event.occurredAt);
  if (!isValidDate(occurredAt)) {
    throw new BadRequestException('Gameplay event occurredAt must be a valid ISO-8601 timestamp');
  }
  if (occurredAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    throw new BadRequestException('Gameplay event occurredAt is too far in the future');
  }
  if (occurredAt < earliestRetainedMonth) {
    throw new BadRequestException(
      'Gameplay event occurredAt is older than the retention window',
    );
  }
  const validated = validateGameplayEventPayload(event.kind, event.payload);
  return {
    eventId: event.eventId,
    occurredAt,
    kind: validated.kind,
    payload: validated.payload,
  };
}

// A batch that repeats a row would rely on intra-statement conflict handling and
// make insertedCount ambiguous; collapse it up front instead.
function dedupe(
  events: readonly NormalizedGameplayEvent[],
): readonly NormalizedGameplayEvent[] {
  const unique = new Map<string, NormalizedGameplayEvent>();
  for (const event of events) {
    unique.set(`${event.eventId}:${event.occurredAt.toISOString()}`, event);
  }
  return [...unique.values()];
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}
