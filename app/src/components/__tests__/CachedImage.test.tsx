const mockFiles = Array.from({ length: 101 }, (_, index) => `image-${index}.img`);
const mockModificationTimes = new Map(mockFiles.map((file, index) => [file, index]));
const mockDeletedPaths: string[] = [];

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn((path: string) => {
    const file = path.split('/').pop() ?? '';
    return Promise.resolve({
      exists: true,
      isDirectory: false,
      size: 1,
      modificationTime: mockModificationTimes.get(file) ?? 0,
      uri: path,
    });
  }),
  readDirectoryAsync: jest.fn(() => Promise.resolve(mockFiles)),
  deleteAsync: jest.fn((path: string) => {
    mockDeletedPaths.push(path);
    return Promise.resolve();
  }),
}));

jest.mock('../../observability/sentry', () => ({
  captureCachedImageError: jest.fn(),
}));

import {
  pruneDiskCacheIfNeeded,
  releaseCachedPath,
  retainCachedPath,
} from '../CachedImage';

describe('CachedImage disk cache pruning', () => {
  beforeEach(() => {
    mockDeletedPaths.length = 0;
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
});
