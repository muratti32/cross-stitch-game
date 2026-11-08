import { QueryClient } from '@tanstack/react-query';
import { CatalogApiError } from '../catalog';

const mockApiFetch = jest.fn();
const mockGet = jest.fn();
const mockDelete = jest.fn();

jest.mock('../apiFetch', () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));
jest.mock('../../local-db', () => ({
  getCatalogCache: (...a: unknown[]) => mockGet(...a),
  setCatalogCache: async () => undefined,
  deleteCatalogCache: (...a: unknown[]) => mockDelete(...a),
}));

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { useCatalogPattern } from '../catalog';

const ID = '7f2a4f0e-9f27-4a57-9d1b-3a6f2e0f5c11';
const cached = { surfaceKey: 'k', payloadJson: JSON.stringify({ id: ID, title: 'Old' }), fetchedAt: 'x' };

async function run(id: string = ID) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let latest!: ReturnType<typeof useCatalogPattern>;
  function Harness() {
    latest = useCatalogPattern(id, true);
    return null;
  }
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    do {
      await new Promise((res) => setTimeout(res, 1));
    } while (client.isFetching() > 0);
  });
  await act(async () => r.unmount());
  client.clear();
  return latest;
}

describe('useCatalogPattern availability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue(cached);
  });

  it('shows unavailable and evicts the cached copy on 404', async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not found' }),
    });
    const result = await run();
    expect(result.isError).toBe(true);
    expect(result.error).toBeInstanceOf(CatalogApiError);
    expect(result.data).toBeUndefined();
    expect(mockDelete).toHaveBeenCalled();
  });

  it('still serves the cached copy on a server failure', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const result = await run();
    expect(result.data?.fromCache).toBe(true);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('requests the UUID id path', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: ID }) });
    await run();
    expect(mockApiFetch.mock.calls[0][0]).toContain(`/v1/catalog/patterns/${ID}`);
  });

  it('never fetches a non-UUID id', async () => {
    const result = await run('../x/not-an-id');
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(result.data).toBeUndefined();
    expect(result.isError).toBe(false);
  });
});
