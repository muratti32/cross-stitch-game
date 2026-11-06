import { BundledStarterSeeder } from './bundled-starter-seeder.service';
import { BUNDLED_STARTERS } from './bundled-starters.generated';
import { catalogPatternObjectKeys } from './pattern-object-keys';

type Row = { id: string; values: readonly unknown[] };

function harness({ seededIds = [] as readonly string[], checksum = '' } = {}) {
  const events: string[] = [];
  const rows = new Map<string, Row>(seededIds.map((id) => [id, { id, values: [] }]));
  const registry = new Map<string, readonly unknown[]>();

  const query = jest.fn(async (sql: string, params: readonly unknown[]): Promise<readonly object[]> => {
    await Promise.resolve();
    if (sql.includes('object_registry')) {
      registry.set(String(params[0]), params);
      events.push(`register:${String(params[0])}`);
      return [];
    }
    if (sql.includes('INSERT INTO catalog.patterns')) {
      const id = String(params[0]);
      if (!rows.has(id)) rows.set(id, { id, values: params });
      events.push(`row:${id}`);
      return [];
    }
    if (sql.includes('FROM catalog.patterns')) {
      const row = rows.get(String(params[0]));
      return row ? [{ checksum: checksum || starterChecksum(row.id) }] : [];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const manager = { query };
  const dataSource = {
    query,
    transaction: jest.fn(async (work: (value: typeof manager) => Promise<void>) => {
      const before = new Map(rows);
      try {
        await work(manager);
      } catch (error) {
        rows.clear();
        for (const [id, row] of before) rows.set(id, row);
        throw error;
      }
    }),
  };
  const storage = {
    put: jest.fn(async (key: string): Promise<void> => {
      await Promise.resolve();
      events.push(`put:${key}`);
    }),
  };
  const seeder = new BundledStarterSeeder(dataSource as never, storage as never);
  return { events, query, registry, rows, seeder, storage };
}

function starterChecksum(id: string): string {
  return BUNDLED_STARTERS.find((starter) => starter.id === id)?.artifact.checksum ?? '';
}

const [firstStarter] = BUNDLED_STARTERS;
const firstKeys = catalogPatternObjectKeys(firstStarter.id);

describe('BundledStarterSeeder.ensure', () => {
  it('writes both objects and their registry rows before the catalog row', async () => {
    const { events, seeder } = harness();

    await seeder.ensure();

    expect(events.slice(0, 5)).toEqual([
      `put:${firstKeys.artifact}`,
      `put:${firstKeys.preview}`,
      `register:${firstKeys.artifact}`,
      `register:${firstKeys.preview}`,
      `row:${firstStarter.id}`,
    ]);
  });

  it('seeds a free, available-by-default catalog row with no thumbnail for every starter', async () => {
    const { query, rows, seeder } = harness();

    await seeder.ensure();

    expect([...rows.keys()].sort()).toEqual(BUNDLED_STARTERS.map((starter) => starter.id).sort());
    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO catalog.patterns'));
    expect(insert?.[0]).not.toMatch(/thumbnail_renderer_version|unlock_price_tier|status/);
    expect(insert?.[1]).toEqual(
      expect.arrayContaining([firstStarter.id, firstStarter.stitchableCellCount, firstStarter.publishedAt, 'other']),
    );
  });

  it('stores the artifact bytes the app bundles and registers their checksum', async () => {
    const { registry, seeder, storage } = harness();

    await seeder.ensure();

    expect(storage.put).toHaveBeenCalledWith(
      firstKeys.artifact,
      Buffer.from(firstStarter.artifact.base64, 'base64'),
      'application/octet-stream',
    );
    expect(registry.get(firstKeys.artifact)).toEqual([
      firstKeys.artifact,
      firstStarter.artifact.checksum,
      firstStarter.artifact.byteLength,
    ]);
    expect(registry).toHaveProperty('size', BUNDLED_STARTERS.length * 2);
  });

  it('leaves existing rows and their objects untouched', async () => {
    const { query, seeder, storage } = harness({
      seededIds: BUNDLED_STARTERS.map((starter) => starter.id),
    });

    await seeder.ensure();

    expect(storage.put).not.toHaveBeenCalled();
    expect(query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true);
  });

  it('never updates a row whose checksum differs', async () => {
    const { query, seeder, storage } = harness({
      seededIds: BUNDLED_STARTERS.map((starter) => starter.id),
      checksum: 'f'.repeat(64),
    });

    await seeder.ensure();

    expect(storage.put).not.toHaveBeenCalled();
    expect(query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true);
  });

  it('finishes only the starters a partial run left out', async () => {
    const { rows, seeder, storage } = harness({ seededIds: [firstStarter.id] });

    await seeder.ensure();

    expect(rows.size).toBe(BUNDLED_STARTERS.length);
    expect(storage.put).not.toHaveBeenCalledWith(firstKeys.artifact, expect.anything(), expect.anything());
  });

  it('does nothing once a run has succeeded', async () => {
    const { query, seeder, storage } = harness();

    await seeder.ensure();
    const calls = query.mock.calls.length;
    const puts = storage.put.mock.calls.length;
    await seeder.ensure();

    expect(query.mock.calls).toHaveLength(calls);
    expect(storage.put.mock.calls).toHaveLength(puts);
  });

  it('leaves no row when an object fails, then retries on the next call', async () => {
    const { rows, seeder, storage } = harness();
    storage.put.mockRejectedValueOnce(new Error('bucket unavailable'));

    await expect(seeder.ensure()).resolves.toBeUndefined();
    expect(rows.size).toBe(0);

    await seeder.ensure();
    expect(rows.size).toBe(BUNDLED_STARTERS.length);
  });

  it('leaves no row when the registry write fails', async () => {
    const { query, rows, seeder } = harness();
    query.mockImplementationOnce(async () => {
      await Promise.resolve();
      return [];
    });
    query.mockImplementationOnce(async () => {
      await Promise.resolve();
      throw new Error('database unavailable');
    });

    await expect(seeder.ensure()).resolves.toBeUndefined();

    expect(rows.size).toBe(0);
  });
});
