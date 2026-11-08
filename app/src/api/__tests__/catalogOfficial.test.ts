import { getCatalogCache } from '../../local-db';
import { isOfficialCatalogItem, readCachedOfficialStatus, resolveSessionOfficial } from '../catalog';

jest.mock('../apiFetch', () => ({ apiFetch: jest.fn() }));
jest.mock('../../local-db', () => ({
  getCatalogCache: jest.fn(),
  setCatalogCache: jest.fn(),
  deleteCatalogCache: jest.fn(),
}));
const cache = getCatalogCache as jest.Mock;

describe('official flag resolution', () => {
  beforeEach(() => cache.mockReset());

  it('treats no creator profile as Official and a profile as Community', () => {
    expect(isOfficialCatalogItem({ creatorProfileId: null })).toBe(true);
    expect(isOfficialCatalogItem({ creatorProfileId: 'cp' })).toBe(false);
    expect(isOfficialCatalogItem({})).toBeNull();
  });

  it('prefers the flag recorded on the session without touching the cache', async () => {
    await expect(resolveSessionOfficial({ patternId: 'p', official: false })).resolves.toBe(false);
    await expect(resolveSessionOfficial({ patternId: 'p', official: true })).resolves.toBe(true);
    expect(cache).not.toHaveBeenCalled();
  });

  it('falls back to the cached pattern detail of any locale', async () => {
    cache.mockImplementation(async (key: string) =>
      key.includes('ja') ? { payloadJson: JSON.stringify({ id: 'p', creatorProfileId: 'cp' }), fetchedAt: 'x' } : null);
    await expect(resolveSessionOfficial({ patternId: 'p', official: null })).resolves.toBe(false);
  });

  it('is unknown when nothing is recorded or cached, or the cache is unreadable', async () => {
    cache.mockResolvedValue(null);
    await expect(readCachedOfficialStatus('p')).resolves.toBeNull();
    cache.mockRejectedValue(new Error('db'));
    await expect(readCachedOfficialStatus('p')).resolves.toBeNull();
  });
});
