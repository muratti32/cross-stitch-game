import type { DataSource } from 'typeorm';

import type { AppConfigService } from '../config/app-config.service';
import { EventsPartitionService } from './events-partition.service';

type QueryCall = { sql: string; parameters?: readonly unknown[] };

describe('EventsPartitionService', () => {
  it('ensures the current and next monthly partitions idempotently', async () => {
    const calls: QueryCall[] = [];
    const dataSource = {
      query: <T>(sql: string, parameters?: readonly unknown[]): Promise<T> => {
        calls.push({ sql, parameters });
        return Promise.resolve([] as T);
      },
    };
    const service = new EventsPartitionService(
      dataSource as unknown as DataSource,
      { gameplayEventRetentionMonths: 13 } as unknown as AppConfigService,
    );

    await service.ensureCurrentAndNextMonth(new Date('2026-07-25T12:00:00.000Z'));
    await service.ensureCurrentAndNextMonth(new Date('2026-07-25T12:00:00.000Z'));

    expect(calls).toHaveLength(4);
    expect(calls.every(({ sql }) => sql.includes('CREATE TABLE IF NOT EXISTS'))).toBe(
      true,
    );
    expect(calls.map(({ sql }) => sql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('gameplay_events_2026_07'),
        expect.stringContaining('gameplay_events_2026_08'),
      ]),
    );
  });

  it('drops only partitions older than the retention window', async () => {
    const calls: QueryCall[] = [];
    const dataSource = {
      query: <T>(sql: string, parameters?: readonly unknown[]): Promise<T> => {
        calls.push({ sql, parameters });
        if (sql.includes('FROM pg_inherits')) {
          return Promise.resolve([
            { partitionName: 'gameplay_events_2025_06' },
            { partitionName: 'gameplay_events_2025_07' },
            { partitionName: 'gameplay_events_2026_07' },
          ] as T);
        }
        return Promise.resolve([] as T);
      },
    };
    const service = new EventsPartitionService(
      dataSource as unknown as DataSource,
      { gameplayEventRetentionMonths: 13 } as unknown as AppConfigService,
    );

    await expect(
      service.dropExpiredPartitions(new Date('2026-07-25T12:00:00.000Z')),
    ).resolves.toBe(1);

    expect(calls.map(({ sql }) => sql)).toContain(
      'DROP TABLE IF EXISTS analytics."gameplay_events_2025_06"',
    );
    expect(calls.map(({ sql }) => sql)).not.toContain(
      'DROP TABLE IF EXISTS analytics."gameplay_events_2025_07"',
    );
    expect(calls.map(({ sql }) => sql)).not.toContain(
      'DROP TABLE IF EXISTS analytics."gameplay_events_2026_07"',
    );
  });
});
