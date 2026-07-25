import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';

type PartitionRow = { partitionName: string };

@Injectable()
export class EventsPartitionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
  ) {}

  async maintain(now = new Date()): Promise<{ droppedPartitions: number }> {
    await this.ensureCurrentAndNextMonth(now);
    return { droppedPartitions: await this.dropExpiredPartitions(now) };
  }

  async ensureCurrentAndNextMonth(now = new Date()): Promise<void> {
    const currentMonth = monthStart(now);
    await this.ensureMonths([currentMonth, addMonths(currentMonth, 1)]);
  }

  async ensureMonths(months: readonly Date[]): Promise<void> {
    const uniqueMonths = new Map<string, Date>();
    for (const month of months) {
      const normalized = monthStart(month);
      uniqueMonths.set(partitionName(normalized), normalized);
    }

    for (const [name, month] of uniqueMonths) {
      const nextMonth = addMonths(month, 1);
      await this.dataSource.query(createPartitionSql(name, month, nextMonth));
    }
  }

  /**
   * Start of the oldest month whose partition retention still keeps. An event
   * older than this has nowhere to land - its partition is already dropped, or
   * would be dropped by the next maintenance pass - so ingest rejects it rather
   * than provisioning a partition that only exists to be deleted.
   */
  earliestRetainedMonth(now = new Date()): Date {
    return addMonths(
      monthStart(now),
      -(this.config.gameplayEventRetentionMonths - 1),
    );
  }

  async dropExpiredPartitions(now = new Date()): Promise<number> {
    const earliestRetainedMonth = this.earliestRetainedMonth(now);
    const partitions = await this.dataSource.query<PartitionRow[]>(
      `SELECT child.relname AS "partitionName"
       FROM pg_inherits
       JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
       JOIN pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace
       JOIN pg_class child ON child.oid = pg_inherits.inhrelid
       JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
       WHERE parent_namespace.nspname = 'analytics'
         AND parent.relname = 'gameplay_events'
         AND child_namespace.nspname = 'analytics'
         AND child.relname ~ '^gameplay_events_[0-9]{4}_[0-9]{2}$'`,
    );

    const expired = partitions.filter(({ partitionName: name }) => {
      const partitionMonth = parsePartitionMonth(name);
      return partitionMonth !== null && partitionMonth < earliestRetainedMonth;
    });
    for (const { partitionName: name } of expired) {
      await this.dataSource.query(`DROP TABLE IF EXISTS analytics."${name}"`);
    }
    return expired.length;
  }
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function partitionName(month: Date): string {
  const year = month.getUTCFullYear();
  const monthNumber = String(month.getUTCMonth() + 1).padStart(2, '0');
  return `gameplay_events_${year}_${monthNumber}`;
}

function parsePartitionMonth(name: string): Date | null {
  const match = /^gameplay_events_(\d{4})_(\d{2})$/.exec(name);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, 1));
}

function createPartitionSql(name: string, month: Date, nextMonth: Date): string {
  return `DO $$
    BEGIN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.gameplay_events FOR VALUES FROM (%L) TO (%L)',
        '${name}',
        '${month.toISOString()}',
        '${nextMonth.toISOString()}'
      );
    EXCEPTION
      WHEN duplicate_table OR duplicate_object THEN NULL;
    END
    $$`;
}
