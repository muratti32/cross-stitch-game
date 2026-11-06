import { copyOfflinePatternToNamespace, getOfflinePatternPath } from '../index';

const mockFiles = new Map<string, string>();
const mockDirectories: string[] = [];

jest.mock('../../local-db', () => ({ getActiveIdentity: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/docs/',
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockFiles.has(path) })),
  makeDirectoryAsync: jest.fn(async (path: string) => {
    mockDirectories.push(path);
  }),
  deleteAsync: jest.fn(async (path: string) => {
    mockFiles.delete(path);
  }),
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const content = mockFiles.get(from);
    if (content === undefined) throw new Error('missing source');
    if (mockFiles.has(to)) throw new Error('destination exists');
    mockFiles.set(to, content);
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const content = mockFiles.get(from);
    if (content === undefined) throw new Error('missing source');
    mockFiles.set(to, content);
    mockFiles.delete(from);
  }),
}));

const GUEST_PATH = getOfflinePatternPath('pattern', 'guest');
const ACCOUNT_PATH = getOfflinePatternPath('pattern', 'account');

beforeEach(() => {
  mockFiles.clear();
  mockDirectories.length = 0;
});

describe('copyOfflinePatternToNamespace', () => {
  test('copies the artifact and leaves the Guest copy in place', async () => {
    mockFiles.set(GUEST_PATH, 'artifact');

    await copyOfflinePatternToNamespace('pattern', 'guest', 'account');

    expect(mockFiles.get(ACCOUNT_PATH)).toBe('artifact');
    expect(mockFiles.get(GUEST_PATH)).toBe('artifact');
    expect(mockDirectories).toEqual(['/docs/namespace_guest_account/offline-patterns']);
  });

  test('keeps an artifact the account already has', async () => {
    mockFiles.set(GUEST_PATH, 'guest');
    mockFiles.set(ACCOUNT_PATH, 'account');

    await copyOfflinePatternToNamespace('pattern', 'guest', 'account');

    expect(mockFiles.get(ACCOUNT_PATH)).toBe('account');
  });

  test('a partial file left by a kill never reads as the artifact and is replaced', async () => {
    mockFiles.set(GUEST_PATH, 'artifact');
    mockFiles.set(`${ACCOUNT_PATH}.partial`, 'trunc');

    await copyOfflinePatternToNamespace('pattern', 'guest', 'account');

    expect(mockFiles.get(ACCOUNT_PATH)).toBe('artifact');
    expect(mockFiles.has(`${ACCOUNT_PATH}.partial`)).toBe(false);
  });

  test('a missing source is not an error', async () => {
    await expect(copyOfflinePatternToNamespace('pattern', 'guest', 'account')).resolves.toBeUndefined();

    expect(mockFiles.size).toBe(0);
  });
});
