import { prepareBundledSession } from '../index';

// Mock local-db exports that call expo-sqlite
jest.mock('../../local-db', () => ({
  createSession: jest.fn(),
  findActiveSessionForPattern: jest.fn(),
}));

jest.mock('../../sync/bundledSessionRegistrar', () => ({
  registerBundledSessions: jest.fn(),
}));

const localDb = require('../../local-db');
const { registerBundledSessions } = require('../../sync/bundledSessionRegistrar');

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
    expect(registerBundledSessions).toHaveBeenCalledTimes(1);
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
    expect(registerBundledSessions).not.toHaveBeenCalled();
  });

  test('resumes a catalog session an older app started on the starter', async () => {
    const catalogRow = { id: 'session_catalog', patternId: 'p1', source: 'catalog' };
    localDb.findActiveSessionForPattern.mockImplementation(async (_id: string, source: string) =>
      source === 'catalog' ? catalogRow : null,
    );

    const result = await prepareBundledSession('p1', 'chk');

    expect(result).toBe(catalogRow);
    expect(localDb.createSession).not.toHaveBeenCalled();
  });

  test('coalesces concurrent taps into one session creation', async () => {
    localDb.findActiveSessionForPattern.mockResolvedValue(null);
    let release!: (session: object) => void;
    localDb.createSession.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const first = prepareBundledSession('starter_heart', 'chk');
    const second = prepareBundledSession('starter_heart', 'chk');
    await new Promise(process.nextTick);
    const created = { id: 'session_one', patternId: 'starter_heart' };
    release(created);

    await expect(Promise.all([first, second])).resolves.toEqual([created, created]);
    expect(localDb.createSession).toHaveBeenCalledTimes(1);
  });
});
