import { prepareBundledSession } from '../index';

// Mock local-db exports that call expo-sqlite
jest.mock('../../local-db', () => ({
  createSession: jest.fn(),
  findActiveSessionForPattern: jest.fn(),
}));

const localDb = require('../../local-db');

describe('prepareBundledSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates a new session when the pattern has no active session', async () => {
    localDb.findActiveSessionForPattern.mockResolvedValue(null);
    const created = {
      id: 'session_new',
      patternId: 'p1',
      source: 'bundled',
      artifactChecksum: 'chk',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'ready',
    };
    localDb.createSession.mockResolvedValue(created);

    const result = await prepareBundledSession('p1', 'chk');

    expect(localDb.findActiveSessionForPattern).toHaveBeenCalledWith('p1', 'bundled');
    expect(localDb.createSession).toHaveBeenCalledWith('p1', 'chk');
    expect(result).toBe(created);
  });

  test('resumes the existing active session instead of creating a duplicate', async () => {
    const existing = {
      id: 'session_existing',
      patternId: 'p1',
      source: 'bundled',
      artifactChecksum: 'chk',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'ready',
    };
    localDb.findActiveSessionForPattern.mockResolvedValue(existing);

    const result = await prepareBundledSession('p1', 'chk');

    expect(result).toBe(existing);
    expect(localDb.createSession).not.toHaveBeenCalled();
  });

  test('coalesces concurrent taps into one session creation', async () => {
    localDb.findActiveSessionForPattern.mockResolvedValue(null);
    let release!: (session: object) => void;
    localDb.createSession.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const first = prepareBundledSession('starter_heart', 'chk');
    const second = prepareBundledSession('starter_heart', 'chk');
    await Promise.resolve();
    const created = { id: 'session_one', patternId: 'starter_heart' };
    release(created);

    await expect(Promise.all([first, second])).resolves.toEqual([created, created]);
    expect(localDb.findActiveSessionForPattern).toHaveBeenCalledTimes(1);
    expect(localDb.createSession).toHaveBeenCalledTimes(1);
  });
});
