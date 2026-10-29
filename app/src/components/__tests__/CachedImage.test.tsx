const mockFiles = Array.from({ length: 101 }, (_, index) => `image-${index}.img`);
const mockModificationTimes = new Map(mockFiles.map((file, index) => [file, index]));
const mockDeletedPaths: string[] = [];
const mockMissingPaths = new Set<string>();

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn((path: string) => {
    if (mockMissingPaths.has(path)) {
      return Promise.resolve({ exists: false, isDirectory: false, uri: path });
    }
    const file = path.split('/').pop() ?? '';
    return Promise.resolve({
      exists: true,
      isDirectory: false,
      size: 1,
      modificationTime: mockModificationTimes.get(file) ?? 0,
      uri: path,
    });
  }),
  readDirectoryAsync: jest.fn((path: string) =>
    mockMissingPaths.has(path)
      ? Promise.reject(new Error(`Uri '${path}' doesn't exist or isn't a directory`))
      : Promise.resolve(mockFiles),
  ),
  deleteAsync: jest.fn((path: string) => {
    mockDeletedPaths.push(path);
    return Promise.resolve();
  }),
}));

jest.mock('../../observability/sentry', () => ({
  captureCachedImageError: jest.fn(),
}));

import * as FileSystem from 'expo-file-system/legacy';

import { captureCachedImageError } from '../../observability/sentry';
import {
  pruneDiskCacheIfNeeded,
  releaseCachedPath,
  retainCachedPath,
} from '../CachedImage';

describe('CachedImage disk cache pruning', () => {
  beforeEach(() => {
    mockDeletedPaths.length = 0;
    mockMissingPaths.clear();
    jest.mocked(captureCachedImageError).mockClear();
  });

  test('sorts by modification time and skips paths mounted by live images', async () => {
    const dir = '/cache/catalog-previews/';
    const inUsePath = `${dir}image-0.img`;
    retainCachedPath(inUsePath);

    await pruneDiskCacheIfNeeded(dir);

    expect(mockDeletedPaths).toContain(`${dir}image-1.img`);
    expect(mockDeletedPaths).not.toContain(inUsePath);
    releaseCachedPath(inUsePath);
  });

  test('treats a missing cache directory as an empty cache', async () => {
    const dir = '/cache/catalog-previews/';
    mockMissingPaths.add(dir);

    await expect(pruneDiskCacheIfNeeded(dir)).resolves.toBeUndefined();

    expect(captureCachedImageError).not.toHaveBeenCalled();
    expect(mockDeletedPaths).toEqual([]);
  });

  test('reports a prune failure on an existing cache directory', async () => {
    const dir = '/cache/catalog-previews/';
    const failure = new Error('permission denied');
    jest.mocked(FileSystem.readDirectoryAsync).mockRejectedValueOnce(failure);

    await pruneDiskCacheIfNeeded(dir);

    expect(captureCachedImageError).toHaveBeenCalledWith('prune-disk-cache', failure);
  });
});
