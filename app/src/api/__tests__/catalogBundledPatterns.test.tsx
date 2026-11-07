import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';

import { useCatalogSearch, useNewPatterns, usePatternsBrowse, useStaffPicks, type CatalogPatternItem } from '../catalog';

const mockApiFetch = jest.fn();

jest.mock('../apiFetch', () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));
jest.mock('../../local-db', () => ({
  getCatalogCache: async () => null,
  setCatalogCache: async () => undefined,
}));

const STARTER_HEART = 'dc47c329-35fd-4173-9ad9-5098369beb44';
const COMMUNITY = '7f2a4f0e-9f27-4a57-9d1b-3a6f2e0f5c11';

const item = (id: string) => ({ id, title: id }) as CatalogPatternItem;
const listing = [item(STARTER_HEART), item(COMMUNITY)];

function respondWith(body: unknown): void {
  mockApiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
}

async function settled<T>(useHook: () => T): Promise<T> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let latest!: T;
  function Harness() {
    latest = useHook();
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    do {
      await new Promise((resolve) => setTimeout(resolve, 1));
    } while (client.isFetching() > 0);
    await new Promise((resolve) => setTimeout(resolve, 1));
  });
  await act(async () => {
    renderer.unmount();
  });
  client.clear();
  return latest;
}

const ids = (items: CatalogPatternItem[] | undefined) => items?.map((entry) => entry.id);

describe('catalog surfaces hide the seeded Bundled Starter Patterns', () => {
  beforeEach(() => mockApiFetch.mockReset());

  test('Staff Picks', async () => {
    respondWith(listing);

    const result = await settled(() => useStaffPicks());

    expect(ids(result.data?.data)).toEqual([COMMUNITY]);
  });

  test('new patterns, without losing the cursor of a page the hide shortened', async () => {
    respondWith({ items: listing, nextCursor: 'next' });

    const result = await settled(() => useNewPatterns());

    expect(ids(result.data?.pages[0].data.items)).toEqual([COMMUNITY]);
    expect(result.hasNextPage).toBe(true);
  });

  test('browse', async () => {
    respondWith({ items: listing, nextCursor: null });

    const result = await settled(() => usePatternsBrowse({ category: 'other' }));

    expect(ids(result.data?.pages[0].data.items)).toEqual([COMMUNITY]);
  });

  test('search', async () => {
    respondWith(listing);

    const result: UseQueryResult<CatalogPatternItem[]> = await settled(() => useCatalogSearch('heart'));

    expect(ids(result.data)).toEqual([COMMUNITY]);
  });
});
