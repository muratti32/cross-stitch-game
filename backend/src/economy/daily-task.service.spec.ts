import type { DataSource, EntityManager } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import type { CoinLedgerRepository, LedgerPrincipal } from './coin-ledger.repository';
import { DAILY_TASK_CELLS_TARGET, type DailyTaskKey } from './economy.constants';
import { DailyTaskService } from './daily-task.service';
import { utcRewardDay } from './reward-day';
import type { GameplayEventDto } from './daily-task.dto';

const GUEST_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '1bc5c633-8546-40f5-b408-926b652a6ed9';

function uuid(n: number): string {
  const tail = n.toString(16).padStart(12, '0');
  return `22222222-2222-4222-8222-${tail}`;
}

/** Assigns dmcCode round-robin across `codes` so a batch spans several colors. */
function withCyclingDmcCodes(events: GameplayEventDto[], codes: string[]): GameplayEventDto[] {
  return events.map((event, i) => ({ ...event, dmcCode: codes[i % codes.length] }));
}

/**
 * A Stitch Sweep: one gesture dragging across matching cells. Each newly filled
 * cell is its own Stitch Action, so the inter-event deltas are pointer-frame
 * sized (0-20 ms), exactly as seen in the reported backend warnings.
 */
function sweepEvents(
  count: number,
  startIso: string,
  idOffset = 0,
): GameplayEventDto[] {
  const start = new Date(startIso).getTime();
  const deltas = [0, 1, 1, 2, 16, 0, 1, 17, 2, 1];
  let t = start;
  return Array.from({ length: count }, (_, i) => {
    if (i > 0) t += deltas[i % deltas.length];
    return {
      eventId: uuid(idOffset + i),
      kind: 'stitch_action' as const,
      sessionId: SESSION_ID,
      dmcCode: '310',
      clientSeq: idOffset + i + 1,
      occurredAt: new Date(t).toISOString(),
    };
  });
}

type GrantDailyTaskMock = jest.Mock<
  Promise<void>,
  [EntityManager, LedgerPrincipal, string, DailyTaskKey]
>;

// Typed so a test reading `query.mock.calls` to inspect the real SQL params
// (e.g. the batched insert's unnest arrays) gets those params typed, not `any`.
type QueryMock = jest.Mock<unknown, [string, unknown[]?]>;

function makeService(options: { ownsSession?: boolean } = {}): {
  service: DailyTaskService;
  insertedStitchEventIds: string[];
  grantDailyTask: GrantDailyTaskMock;
  query: QueryMock;
} {
  const ownsSession = options.ownsSession ?? true;
  const insertedStitchEventIds: string[] = [];
  // ON CONFLICT DO NOTHING across the whole service lifetime: an eventId seen
  // in an earlier call (or earlier in the same unnest batch) never inserts again.
  const seenEventIds = new Set<string>();
  // Keyed exactly like PK_daily_color_action_counts so a reward-day or
  // principal regression cannot hide behind a mock that ignores them.
  const colorCounts = new Map<string, number>();
  const countKey = (
    principalType: string,
    principalId: string,
    rewardDay: string,
    dmcCode: string,
  ): string => `${principalType}|${principalId}|${rewardDay}|${dmcCode}`;

  const query: QueryMock = jest.fn((sql: string, params?: unknown[]) => {
    if (sql.includes('FROM sessions.stitching_sessions')) {
      // Postgres uuid columns always come back lowercase regardless of the
      // casing a client queried with — model that here so a service that
      // forgets to normalize before comparing fails this mock's tests too.
      return ownsSession
        ? (params?.[0] as string[]).map((id) => ({ id: id.toLowerCase() }))
        : [];
    }
    if (sql.includes('INSERT INTO economy.gameplay_events')) {
      // Batched unnest insert: $1 principal_type, $2 principal_id, then one
      // array per gameplay_events column in unnest's column order.
      const [, , eventIds, , kinds] = params as [
        string,
        string,
        string[],
        string[],
        string[],
        string[],
        string[],
        number[],
        (Date | null)[],
      ];
      const inserted: { event_id: string }[] = [];
      eventIds.forEach((eventId, i) => {
        // Postgres normalizes the uuid column to lowercase on the way back
        // out, same as the session-ownership rows above.
        const normalizedId = eventId.toLowerCase();
        // First occurrence within the batch wins, matching ON CONFLICT DO
        // NOTHING against rows already committed by an earlier call.
        if (seenEventIds.has(normalizedId)) return;
        seenEventIds.add(normalizedId);
        inserted.push({ event_id: normalizedId });
        if (kinds[i] === 'stitch_action') insertedStitchEventIds.push(normalizedId);
      });
      return inserted;
    }
    if (sql.includes('INSERT INTO economy.daily_color_action_counts')) {
      // Batched unnest upsert: $1 principal_type, $2 principal_id, then
      // reward_day[], dmc_code[], action_count[] — each key appears once.
      const [principalType, principalId, rewardDays, dmcCodes, counts] = params as [
        string,
        string,
        string[],
        string[],
        number[],
      ];
      rewardDays.forEach((rewardDay, i) => {
        const key = countKey(principalType, principalId, rewardDay, dmcCodes[i]);
        colorCounts.set(key, (colorCounts.get(key) ?? 0) + counts[i]);
      });
      return [];
    }
    if (sql.includes('FROM economy.daily_color_action_counts')) {
      const [principalType, principalId, rewardDay] = params as string[];
      const prefix = `${principalType}|${principalId}|${rewardDay}|`;
      return [...colorCounts.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, action_count]) => ({ action_count }));
    }
    if (sql.includes("kind = 'color_completion'")) {
      return [{ exists: false }];
    }
    if (sql.includes('FROM economy.coin_balances')) {
      return [{ balance: '0' }];
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  const manager = { query } as unknown as EntityManager;
  const dataSource = {
    manager,
    transaction: async <T>(fn: (m: EntityManager) => Promise<T>) => fn(manager),
  } as unknown as DataSource;

  const grantDailyTask: GrantDailyTaskMock = jest
    .fn<Promise<void>, [EntityManager, LedgerPrincipal, string, DailyTaskKey]>()
    .mockResolvedValue(undefined);
  const ledger = {
    getBalance: jest.fn().mockResolvedValue(0),
    grantedDailyTaskKeys: jest.fn().mockResolvedValue(new Set<string>()),
    grantDailyTask,
  } as unknown as CoinLedgerRepository;

  return {
    service: new DailyTaskService(dataSource, ledger),
    insertedStitchEventIds,
    grantDailyTask,
    query,
  };
}

const principal: AuthPrincipal = {
  type: PrincipalType.Guest,
  id: GUEST_ID,
} as AuthPrincipal;

describe('DailyTaskService.ingest — Stitch Sweep evidence', () => {
  it('counts every newly filled cell of a Stitch Sweep as a Stitch Action', async () => {
    const { service, insertedStitchEventIds } = makeService();
    const events = sweepEvents(20, new Date().toISOString());

    const board = await service.ingest(principal, events);

    expect(insertedStitchEventIds).toHaveLength(20);
    expect(board.tasks.find((t) => t.key === 'cells_100')?.progress).toBe(20);
  });

  it('counts a sweep whose queued stitches drain in a single JS turn', async () => {
    const { service, insertedStitchEventIds } = makeService();
    const start = new Date().toISOString();
    // useRendererGesture stitches at most one cell per UI frame (deduped via
    // lastStitchedX/lastStitchedY) and hands each to the JS thread with
    // runOnJS; useStitchingSession stamps occurredAt with `new Date()` when
    // the JS thread processes it. Several UI-frame stitches can still drain
    // in one JS turn, so their evidence shares a millisecond or lands 0-2 ms
    // apart — not because one gesture sample crosses many cells.
    const events = sweepEvents(40, start).map((event) => ({
      ...event,
      occurredAt: start,
    }));

    await service.ingest(principal, events);

    expect(insertedStitchEventIds).toHaveLength(40);
  });

  it('still rejects evidence dated beyond the clock-skew tolerance', async () => {
    const { service, insertedStitchEventIds } = makeService();
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const events = sweepEvents(3, future);

    await service.ingest(principal, events);

    expect(insertedStitchEventIds).toHaveLength(0);
  });

  it('rejects a future-dated event even when a differently-cased copy of its id is valid', async () => {
    const { service, insertedStitchEventIds } = makeService();
    // idOffset 0xabc so the id contains hex letters — an all-digit id would
    // make toUpperCase() a no-op and hide the casing bug this guards against.
    const validEvent = sweepEvents(1, new Date().toISOString(), 0xabc)[0];
    const futureCasedCopy: GameplayEventDto = {
      ...validEvent,
      eventId: validEvent.eventId.toUpperCase(),
      occurredAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };

    await service.ingest(principal, [futureCasedCopy, validEvent]);

    // Same id under the hood; the future-dated casing must not let the
    // validly-dated casing slip through as a separate event.
    expect(insertedStitchEventIds).toHaveLength(0);
  });

  it('ignores evidence for a session the principal does not own', async () => {
    const { service, insertedStitchEventIds } = makeService({ ownsSession: false });

    await service.ingest(principal, sweepEvents(20, new Date().toISOString()));

    expect(insertedStitchEventIds).toHaveLength(0);
  });

  it('completes and grants cells_100 once the sweep reaches the target', async () => {
    const { service, grantDailyTask } = makeService();

    const board = await service.ingest(
      principal,
      sweepEvents(DAILY_TASK_CELLS_TARGET, new Date().toISOString()),
    );

    const task = board.tasks.find((t) => t.key === 'cells_100');
    expect(task?.progress).toBe(DAILY_TASK_CELLS_TARGET);
    expect(task?.completed).toBe(true);
    expect(grantDailyTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: GUEST_ID }),
      utcRewardDay(),
      'cells_100',
    );
  });

  it('settles an offline backlog on the Reward Day each event happened in', async () => {
    const { service, grantDailyTask } = makeService();
    // A player who stitched offline yesterday and resumed today flushes both
    // days in one batch. Each event's own occurredAt owns its Reward Day, so
    // yesterday's finished task is still granted against yesterday.
    const yesterday = new Date(Date.now() - 24 * 60 * 60_000);
    const yesterdayNoon = new Date(
      Date.UTC(
        yesterday.getUTCFullYear(),
        yesterday.getUTCMonth(),
        yesterday.getUTCDate(),
        12,
      ),
    );

    await service.ingest(principal, [
      ...sweepEvents(DAILY_TASK_CELLS_TARGET, yesterdayNoon.toISOString()),
      ...sweepEvents(20, new Date().toISOString(), DAILY_TASK_CELLS_TARGET),
    ]);

    const grantedDays = grantDailyTask.mock.calls
      .filter((call) => call[3] === 'cells_100')
      .map((call) => call[2]);
    expect(grantedDays).toEqual([utcRewardDay(yesterdayNoon)]);
    expect(grantedDays).not.toContain(utcRewardDay());
  });

  it('deduplicates replayed evidence by eventId', async () => {
    const { service, insertedStitchEventIds } = makeService();
    const events = sweepEvents(20, new Date().toISOString());

    await service.ingest(principal, events);
    const board = await service.ingest(principal, events);

    expect(insertedStitchEventIds).toHaveLength(20);
    expect(board.tasks.find((t) => t.key === 'cells_100')?.progress).toBe(20);
  });

  it('deduplicates the same eventId repeated inside one batch, keeping the first occurrence', async () => {
    const { service, insertedStitchEventIds, query } = makeService();
    const events = sweepEvents(20, new Date().toISOString());
    // A duplicate copy with a different dmcCode: if the batch insert did not
    // dedupe before sending it, the ON CONFLICT DO NOTHING mock would still
    // see a second array entry for the same eventId, and this dmcCode would
    // leak into the color-count aggregation for one insertable row.
    const duplicateWithDifferentColor: GameplayEventDto = { ...events[0], dmcCode: '999' };
    const withDuplicate = [...events, duplicateWithDifferentColor];

    const board = await service.ingest(principal, withDuplicate);

    expect(insertedStitchEventIds).toHaveLength(20);
    expect(board.tasks.find((t) => t.key === 'cells_100')?.progress).toBe(20);

    const insertCall = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO economy.gameplay_events'),
    );
    const [, , eventIds, , , , dmcCodes] = insertCall![1] as [
      string, string, string[], string[], string[], string[], string[],
    ];
    expect(eventIds).toHaveLength(20); // the duplicate eventId collapsed to one row
    const dedupedIndex = eventIds.indexOf(events[0].eventId);
    expect(dmcCodes[dedupedIndex]).toBe('310'); // first occurrence wins, not '999'
  });

  it('issues a constant number of queries regardless of batch size or color variety', async () => {
    // Small batch: one dmcCode. Large batch: five distinct dmcCodes. A
    // per-event loop would fail this on event count alone; a per-(day, dmc)
    // upsert loop would pass with one dmcCode (a loop of one matches a bulk
    // statement) but fail here once the large batch's five colors turn into
    // five separate upsert queries instead of one.
    const small = makeService();
    await small.service.ingest(principal, sweepEvents(5, new Date().toISOString()));

    const large = makeService();
    const codes = ['310', '311', '312', '313', '314'];
    await large.service.ingest(
      principal,
      withCyclingDmcCodes(sweepEvents(500, new Date().toISOString(), 10_000), codes),
    );

    expect(large.query.mock.calls.length).toBe(small.query.mock.calls.length);
  });

  it('counts evidence whose eventId and sessionId arrive uppercase, matching Postgres lowercase ids', async () => {
    const { service, insertedStitchEventIds } = makeService();
    const events = sweepEvents(20, new Date().toISOString()).map((event) => ({
      ...event,
      eventId: event.eventId.toUpperCase(),
      sessionId: event.sessionId.toUpperCase(),
    }));

    const board = await service.ingest(principal, events);

    expect(insertedStitchEventIds).toHaveLength(20);
    expect(board.tasks.find((t) => t.key === 'cells_100')?.progress).toBe(20);
  });

  it('parses occurredAt once, so the stored value and the derived Reward Day agree for a zone-less timestamp', async () => {
    const { service, query } = makeService();
    // No offset: JS and Postgres can read this differently if the raw string
    // ever reaches Postgres instead of a Date parsed by this service.
    const zoneless = '2026-01-01T00:30:00';
    const events: GameplayEventDto[] = [
      {
        eventId: uuid(9100),
        kind: 'stitch_action',
        sessionId: SESSION_ID,
        dmcCode: '310',
        clientSeq: 1,
        occurredAt: zoneless,
      },
    ];

    await service.ingest(principal, events);

    const insertCall = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO economy.gameplay_events'),
    );
    const [, , , rewardDays, , , , , occurredAts] = insertCall![1] as [
      string, string, string[], string[], string[], string[], string[], number[], (Date | null)[],
    ];

    expect(occurredAts[0]).toBeInstanceOf(Date);
    const parsedDate = occurredAts[0] as Date;
    expect(rewardDays[0]).toBe(utcRewardDay(parsedDate));
  });
});
