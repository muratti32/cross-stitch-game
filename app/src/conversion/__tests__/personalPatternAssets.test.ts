import { refreshPersonalSessionAssetUrls } from '../personalPatternAssets';
import type { StitchingSession } from '../../local-db';

jest.mock('../../local-db', () => ({
  updateSessionAssetUrls: jest.fn(async () => undefined),
}));

jest.mock('../api', () => ({
  listPersonalPatterns: jest.fn(),
}));

const localDb = require('../../local-db');
const api = require('../api');

function session(overrides: Partial<StitchingSession> & { id: string }): StitchingSession {
  return {
    patternId: 'pat_1',
    source: 'personal',
    artifactChecksum: 'chk',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'ready',
    ...overrides,
  } as StitchingSession;
}

describe('refreshPersonalSessionAssetUrls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('skips the round-trip when no personal session is listed', async () => {
    const sessions = [session({ id: 's1', source: 'catalog' }), session({ id: 's2', source: 'bundled' })];

    const result = await refreshPersonalSessionAssetUrls(sessions);

    expect(result).toBe(sessions);
    expect(api.listPersonalPatterns).not.toHaveBeenCalled();
    expect(localDb.updateSessionAssetUrls).not.toHaveBeenCalled();
  });

  test('persists and returns re-issued grants for personal sessions', async () => {
    const sessions = [
      session({ id: 's1', patternId: 'pat_1', previewUrl: '/p?exp=1', thumbnailUrl: '/t?exp=1' }),
      session({ id: 's2', patternId: 'pat_1', previewUrl: '/p?exp=1', thumbnailUrl: '/t?exp=1' }),
      session({ id: 's3', patternId: 'pat_catalog', source: 'catalog', thumbnailUrl: '/cdn/t.png' }),
    ];
    api.listPersonalPatterns.mockResolvedValue([
      {
        id: 'pat_1',
        previewUrl: '/p?exp=2',
        thumbnailUrls: { browsing: '/t?exp=2', detail: '/d?exp=2' },
      },
    ]);

    const result = await refreshPersonalSessionAssetUrls(sessions);

    expect(localDb.updateSessionAssetUrls).toHaveBeenCalledTimes(1);
    expect(localDb.updateSessionAssetUrls).toHaveBeenCalledWith('pat_1', 'personal', {
      previewUrl: '/p?exp=2',
      thumbnailUrl: '/t?exp=2',
    });
    expect(result[0].thumbnailUrl).toBe('/t?exp=2');
    expect(result[1].previewUrl).toBe('/p?exp=2');
    expect(result[2]).toBe(sessions[2]);
  });

  test('keeps the array reference when the re-issued grants are unchanged', async () => {
    const sessions = [session({ id: 's1', previewUrl: '/p', thumbnailUrl: '/t' })];
    api.listPersonalPatterns.mockResolvedValue([
      { id: 'pat_1', previewUrl: '/p', thumbnailUrls: { browsing: '/t', detail: '/d' } },
    ]);

    const result = await refreshPersonalSessionAssetUrls(sessions);

    expect(result).toBe(sessions);
  });

  test('clears the stored thumbnail when the pattern has no rendered thumbnail', async () => {
    const sessions = [session({ id: 's1', previewUrl: '/p?exp=1', thumbnailUrl: '/t?exp=1' })];
    api.listPersonalPatterns.mockResolvedValue([
      { id: 'pat_1', previewUrl: '/p?exp=2', thumbnailUrls: null },
    ]);

    const result = await refreshPersonalSessionAssetUrls(sessions);

    expect(localDb.updateSessionAssetUrls).toHaveBeenCalledWith('pat_1', 'personal', {
      previewUrl: '/p?exp=2',
      thumbnailUrl: null,
    });
    expect(result[0].thumbnailUrl).toBeNull();
  });

  test('propagates listing failures so callers can keep the cached urls', async () => {
    api.listPersonalPatterns.mockRejectedValue(new Error('offline'));

    await expect(refreshPersonalSessionAssetUrls([session({ id: 's1' })])).rejects.toThrow('offline');
    expect(localDb.updateSessionAssetUrls).not.toHaveBeenCalled();
  });
});
