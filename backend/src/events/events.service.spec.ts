import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import type { IngestGameplayEventDto } from './dto';
import type { EventsPartitionService } from './events-partition.service';
import { EventsService } from './events.service';

const OCCURRED_AT = '2026-07-25T10:00:00.000Z';
const NOW = new Date('2026-07-25T12:00:00.000Z');
// 13 retained months including July 2026.
const EARLIEST_RETAINED_MONTH = new Date(Date.UTC(2025, 6, 1));

function event(
  eventId: string,
  occurredAt: string = OCCURRED_AT,
): IngestGameplayEventDto {
  return {
    eventId,
    occurredAt,
    kind: 'daily_task_completed',
    payload: { task_key: 'cells_100' },
  };
}

function principal(type: PrincipalType, id: string): AuthPrincipal {
  return { id, tokenVersion: 1, type };
}

/**
 * Stands in for the (event_id, occurred_at) primary key: an insert only returns
 * the rows that were not already stored, which is what insertedCount reports.
 */
function createService(): {
  service: EventsService;
  ensureMonths: jest.Mock;
  storedKeys: Set<string>;
  insertedPrincipalTypes: string[];
} {
  const storedKeys = new Set<string>();
  const insertedPrincipalTypes: string[] = [];
  const query = jest.fn(
    (sql: string, parameters?: readonly unknown[]): Promise<unknown> => {
      if (!sql.includes('INSERT INTO analytics.gameplay_events')) {
        return Promise.resolve([]);
      }
      insertedPrincipalTypes.push(String(parameters?.[1]));
      const rows = JSON.parse(String(parameters?.[0])) as readonly {
        event_id: string;
        occurred_at: string;
      }[];
      return Promise.resolve(
        rows
          .filter((row) => {
            const key = `${row.event_id}:${row.occurred_at}`;
            if (storedKeys.has(key)) {
              return false;
            }
            storedKeys.add(key);
            return true;
          })
          .map((row) => ({ event_id: row.event_id })),
      );
    },
  );
  const ensureMonths = jest.fn().mockResolvedValue(undefined);
  const partitions = {
    earliestRetainedMonth: jest.fn().mockReturnValue(EARLIEST_RETAINED_MONTH),
    ensureMonths,
  } as unknown as EventsPartitionService;

  return {
    ensureMonths,
    insertedPrincipalTypes,
    service: new EventsService({ query } as unknown as DataSource, partitions),
    storedKeys,
  };
}

describe('EventsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('accepts an idempotent replay and inserts one event', async () => {
    const { service, storedKeys } = createService();
    const incoming = event('11111111-1111-4111-8111-111111111111');
    const guest = principal(
      PrincipalType.Guest,
      '22222222-2222-4222-8222-222222222222',
    );

    await expect(service.ingest(guest, [incoming])).resolves.toEqual({
      accepted: true,
      receivedCount: 1,
      insertedCount: 1,
    });
    await expect(service.ingest(guest, [incoming])).resolves.toEqual({
      accepted: true,
      receivedCount: 1,
      insertedCount: 0,
    });

    expect(storedKeys.size).toBe(1);
  });

  it('collapses a batch that repeats the same event', async () => {
    const { service, storedKeys } = createService();
    const incoming = event('11111111-1111-4111-8111-111111111111');

    await expect(
      service.ingest(
        principal(PrincipalType.Guest, '22222222-2222-4222-8222-222222222222'),
        [incoming, incoming],
      ),
    ).resolves.toEqual({ accepted: true, receivedCount: 1, insertedCount: 1 });
    expect(storedKeys.size).toBe(1);
  });

  it('accepts both guest and account principals', async () => {
    const { service, insertedPrincipalTypes } = createService();

    await service.ingest(
      principal(PrincipalType.Guest, '22222222-2222-4222-8222-222222222222'),
      [event('11111111-1111-4111-8111-111111111111')],
    );
    await service.ingest(
      principal(PrincipalType.Account, '33333333-3333-4333-8333-333333333333'),
      [event('44444444-4444-4444-8444-444444444444')],
    );

    expect(insertedPrincipalTypes).toEqual(['guest', 'account']);
  });

  it('provisions only the months of the events it accepted', async () => {
    const { service, ensureMonths } = createService();

    await service.ingest(
      principal(PrincipalType.Guest, '22222222-2222-4222-8222-222222222222'),
      [event('11111111-1111-4111-8111-111111111111')],
    );

    expect(ensureMonths).toHaveBeenCalledWith([new Date(OCCURRED_AT)]);
  });

  it('rejects an occurrence timestamp older than the retention window', async () => {
    const { service, ensureMonths } = createService();

    await expect(
      service.ingest(
        principal(PrincipalType.Guest, '22222222-2222-4222-8222-222222222222'),
        [
          event(
            '11111111-1111-4111-8111-111111111111',
            '2024-01-15T10:00:00.000Z',
          ),
        ],
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ensureMonths).not.toHaveBeenCalled();
  });

  it('rejects a far-future occurrence timestamp instead of provisioning its partition', async () => {
    const { service, ensureMonths } = createService();

    await expect(
      service.ingest(
        principal(PrincipalType.Guest, '22222222-2222-4222-8222-222222222222'),
        [
          event(
            '11111111-1111-4111-8111-111111111111',
            '9999-01-15T10:00:00.000Z',
          ),
        ],
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ensureMonths).not.toHaveBeenCalled();
  });
});
