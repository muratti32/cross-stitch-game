import type { DataSource, EntityManager } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import type { CoinLedgerRepository } from './coin-ledger.repository';
import { DailyTaskService } from './daily-task.service';
import type { GameplayEventDto } from './daily-task.dto';

const GUEST_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '1bc5c633-8546-40f5-b408-926b652a6ed9';

function uuid(n: number): string {
  const tail = n.toString(16).padStart(12, '0');
  return `22222222-2222-4222-8222-${tail}`;
}

/**
 * A Stitch Sweep: one gesture dragging across matching cells. Each newly filled
 * cell is its own Stitch Action, so the inter-event deltas are pointer-frame
 * sized (0-20 ms), exactly as seen in the reported backend warnings.
 */
function sweepEvents(count: number, startIso: string): GameplayEventDto[] {
  const start = new Date(startIso).getTime();
  const deltas = [0, 1, 1, 2, 16, 0, 1, 17, 2, 1];
  let t = start;
  return Array.from({ length: count }, (_, i) => {
    if (i > 0) t += deltas[i % deltas.length];
    return {
      eventId: uuid(i),
      kind: 'stitch_action' as const,
      sessionId: SESSION_ID,
      dmcCode: '310',
      clientSeq: i + 1,
      occurredAt: new Date(t).toISOString(),
    };
  });
}

function makeService(options: { ownsSession?: boolean } = {}): {
  service: DailyTaskService;
  insertedStitchEventIds: string[];
} {
  const ownsSession = options.ownsSession ?? true;
  const insertedStitchEventIds: string[] = [];
  const colorCounts = new Map<string, number>();

  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM sessions.stitching_sessions')) {
      return ownsSession ? (params?.[0] as string[]).map((id) => ({ id })) : [];
    }
    if (sql.includes('INSERT INTO economy.gameplay_events')) {
      const [eventId, , , , kind] = params as string[];
      if (insertedStitchEventIds.includes(eventId)) return [];
      if (kind === 'stitch_action') insertedStitchEventIds.push(eventId);
      return [{ event_id: eventId }];
    }
    if (sql.includes('INSERT INTO economy.daily_color_action_counts')) {
      const dmcCode = (params as string[])[3];
      colorCounts.set(dmcCode, (colorCounts.get(dmcCode) ?? 0) + 1);
      return [];
    }
    if (sql.includes('FROM economy.daily_color_action_counts')) {
      return [...colorCounts.values()].map((action_count) => ({ action_count }));
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

  const ledger = {
    getBalance: jest.fn().mockResolvedValue(0),
    grantedDailyTaskKeys: jest.fn().mockResolvedValue(new Set<string>()),
    grantDailyTask: jest.fn().mockResolvedValue(undefined),
  } as unknown as CoinLedgerRepository;

  return {
    service: new DailyTaskService(dataSource, ledger),
    insertedStitchEventIds,
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

  it('counts a sweep that fills a whole row within a single animation frame', async () => {
    const { service, insertedStitchEventIds } = makeService();
    const start = new Date().toISOString();
    // Edge Auto-Pan can cross many cells between two pointer samples, so a
    // burst of stitch evidence can share one millisecond.
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

  it('ignores evidence for a session the principal does not own', async () => {
    const { service, insertedStitchEventIds } = makeService({ ownsSession: false });

    await service.ingest(principal, sweepEvents(20, new Date().toISOString()));

    expect(insertedStitchEventIds).toHaveLength(0);
  });

  it('deduplicates replayed evidence by eventId', async () => {
    const { service, insertedStitchEventIds } = makeService();
    const events = sweepEvents(20, new Date().toISOString());

    await service.ingest(principal, events);
    const board = await service.ingest(principal, events);

    expect(insertedStitchEventIds).toHaveLength(20);
    expect(board.tasks.find((t) => t.key === 'cells_100')?.progress).toBe(20);
  });
});
