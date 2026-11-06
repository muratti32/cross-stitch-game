import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { RendererState } from '../../renderer/RendererState';
import { useStitchingSession } from '../useStitchingSession';
import type { BundledSessionLink, GameplayEvent, ProgressOperation, StitchingSession } from '../../local-db';
import type { SyncOutcome } from '../../sync/progressSyncEngine';

const mockIdentity = { isAccount: true };
const mockDb = {
  getSession: jest.fn(),
  getProgressOps: jest.fn(),
  getUnackedProgressOps: jest.fn(),
  getLatestCheckpoint: jest.fn(),
  getSyncSnapshot: jest.fn(),
  insertProgressOpsBatch: jest.fn(),
  insertGameplayEventsBatch: jest.fn(),
  saveCheckpoint: jest.fn(),
  updateSessionStatus: jest.fn(),
};
const mockSyncSession = jest.fn();
const mockCompleteSession = jest.fn();
const mockQueueClaim = jest.fn();
const mockLoadBundledPattern = jest.fn();
const mockLinkListeners = new Set<(link: BundledSessionLink) => void>();

jest.mock('../../local-db', () => ({
  initDatabase: async () => undefined,
  getDeviceId: async () => 'device-1',
  getDeviceSeqHigh: async () => 0,
  setDeviceSeqHigh: async () => undefined,
  getGameplaySeqHigh: async () => 0,
  setGameplaySeqHigh: async () => undefined,
  updateSessionError: async () => undefined,
  getActiveIdentity: () => 'account-1',
  unpackCompletedBitmap: (_packed: string, length: number) => new Uint8Array(length),
  getSession: (...args: unknown[]) => mockDb.getSession(...args),
  getProgressOps: (...args: unknown[]) => mockDb.getProgressOps(...args),
  getUnackedProgressOps: (...args: unknown[]) => mockDb.getUnackedProgressOps(...args),
  getLatestCheckpoint: (...args: unknown[]) => mockDb.getLatestCheckpoint(...args),
  getSyncSnapshot: (...args: unknown[]) => mockDb.getSyncSnapshot(...args),
  insertProgressOpsBatch: (...args: unknown[]) => mockDb.insertProgressOpsBatch(...args),
  insertGameplayEventsBatch: (...args: unknown[]) => mockDb.insertGameplayEventsBatch(...args),
  saveCheckpoint: (...args: unknown[]) => mockDb.saveCheckpoint(...args),
  updateSessionStatus: (...args: unknown[]) => mockDb.updateSessionStatus(...args),
}));
jest.mock('../../sync/bundledSessionRegistrar', () => ({
  subscribeBundledSessionLinked: (listener: (link: BundledSessionLink) => void) => {
    mockLinkListeners.add(listener);
    return () => mockLinkListeners.delete(listener);
  },
}));
jest.mock('../../sync/progressSyncEngine', () => ({
  syncSession: (...args: unknown[]) => mockSyncSession(...args),
  completeSession: (...args: unknown[]) => mockCompleteSession(...args),
}));
jest.mock('../../sync/gameplayEventEngine', () => ({
  flushGameplayEventsAndCompletionClaims: async () => undefined,
}));
jest.mock('../../sync/guestCompletionClaimEngine', () => ({
  queueGuestCompletionClaim: (...args: unknown[]) => mockQueueClaim(...args),
}));
jest.mock('../../bundled-patterns', () => ({
  loadBundledPattern: (...args: unknown[]) => mockLoadBundledPattern(...args),
}));
jest.mock('../../session-preparation', () => ({}));
jest.mock('../../pattern-artifact', () => ({}));
jest.mock('../../renderer', () => ({
  RendererState: jest.requireActual('../../renderer/RendererState').RendererState,
}));
jest.mock('../../../modules/perf-thermal', () => ({ getDeviceRenderingProfile: () => 'standard' }));
jest.mock('../../identity/guestIdentity', () => ({ useIdentityStore: { getState: () => mockIdentity } }));
jest.mock('../../onboarding/tutorialEvents', () => ({ emitTutorialEvent: async () => undefined }));
jest.mock('../../analytics/gameplayEvents', () => ({
  captureGameplayEvent: async () => undefined,
  captureSessionGameplayEvent: async () => undefined,
}));
jest.mock('../../api/progressSync', () => ({ ProgressSyncError: class extends Error {} }));

const REMOTE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LOCAL = 'session_local';
// Three stitchable cells and one blank.
const PATTERN = {
  width: 2,
  height: 2,
  grid: new Uint8Array([1, 1, 1, 0]),
  palette: [{ dmcCode: '321', name: 'Red', rgbHex: '#cc0000' }],
};

const row = (overrides: Partial<StitchingSession> = {}) => ({
  id: LOCAL,
  patternId: 'dc47c329-35fd-4173-9ad9-5098369beb44',
  source: 'bundled',
  status: 'active',
  remoteSessionId: null,
  ...overrides,
});

const noChanges = (): SyncOutcome => ({
  serverRevision: 5,
  terminalCompleted: false,
  changedCells: [],
  conflictedCells: [],
});

type Hook = ReturnType<typeof useStitchingSession>;

let hook: Hook;
let renderer: TestRenderer.ReactTestRenderer | undefined;

function Harness({ sessionId }: { sessionId: string }) {
  hook = useStitchingSession(sessionId);
  return null;
}

async function open(): Promise<void> {
  await act(async () => {
    renderer = TestRenderer.create(<Harness sessionId={LOCAL} />);
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

async function link(localSessionId = LOCAL): Promise<void> {
  await act(async () => {
    mockLinkListeners.forEach((listener) => listener({ localSessionId, remoteSessionId: REMOTE }));
    await jest.advanceTimersByTimeAsync(0);
  });
}

async function stitch(x: number, y: number): Promise<void> {
  await act(async () => {
    hook.stitchCell(x, y, 0);
    await jest.advanceTimersByTimeAsync(0);
  });
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

const flushedEvents = (): GameplayEvent[] => mockDb.insertGameplayEventsBatch.mock.calls.flatMap(([events]) => events);
const flushedOps = (): ProgressOperation[] => mockDb.insertProgressOpsBatch.mock.calls.flatMap(([ops]) => ops);

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockLinkListeners.clear();
  mockIdentity.isAccount = true;
  mockDb.getSession.mockImplementation(async () => row());
  mockDb.getProgressOps.mockResolvedValue([]);
  mockDb.getUnackedProgressOps.mockResolvedValue([]);
  mockDb.getLatestCheckpoint.mockResolvedValue(null);
  mockDb.getSyncSnapshot.mockResolvedValue(null);
  mockDb.insertProgressOpsBatch.mockResolvedValue(undefined);
  mockDb.insertGameplayEventsBatch.mockResolvedValue(undefined);
  mockDb.saveCheckpoint.mockResolvedValue(undefined);
  mockDb.updateSessionStatus.mockResolvedValue(undefined);
  mockLoadBundledPattern.mockResolvedValue(PATTERN);
  mockSyncSession.mockImplementation(async () => noChanges());
  mockCompleteSession.mockResolvedValue(undefined);
  mockQueueClaim.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  jest.useRealTimers();
});

describe('a link that fires while the session opens', () => {
  test('before the row is judged, the session opens linked and syncs', async () => {
    mockLoadBundledPattern.mockImplementation(async () => {
      mockLinkListeners.forEach((listener) => listener({ localSessionId: LOCAL, remoteSessionId: REMOTE }));
      return PATTERN;
    });

    await open();

    expect(hook.session?.remoteSessionId).toBe(REMOTE);
    expect(mockSyncSession).toHaveBeenCalledWith(LOCAL, REMOTE, 'device-1', expect.any(Uint8Array));
  });

  test('after the row is judged, the finished load does not erase it', async () => {
    mockDb.getProgressOps.mockImplementation(async () => {
      mockLinkListeners.forEach((listener) => listener({ localSessionId: LOCAL, remoteSessionId: REMOTE }));
      return [];
    });

    await open();

    expect(hook.session?.remoteSessionId).toBe(REMOTE);
    expect(mockSyncSession).toHaveBeenCalledWith(LOCAL, REMOTE, 'device-1', expect.any(Uint8Array));
  });
});

describe('a link that fires on an open session', () => {
  test('moves the session to its remote identity and syncs at once', async () => {
    await open();
    expect(mockSyncSession).not.toHaveBeenCalled();

    await link();

    expect(hook.session?.remoteSessionId).toBe(REMOTE);
    expect(mockSyncSession).toHaveBeenCalledTimes(1);
  });

  test('for another session changes nothing', async () => {
    await open();

    await link('session_other');

    expect(hook.session?.remoteSessionId).toBeNull();
    expect(mockSyncSession).not.toHaveBeenCalled();
  });

  test('a Guest gains the remote identity but no progress sync', async () => {
    mockIdentity.isAccount = false;
    await open();

    await link();
    await tick(4_000);

    expect(hook.session?.remoteSessionId).toBe(REMOTE);
    expect(mockSyncSession).not.toHaveBeenCalled();
  });

  test('stitches after the link carry the remote id and stitches before it carry none', async () => {
    await open();
    await stitch(0, 0);
    await tick(500);
    expect(flushedEvents()).toEqual([]);

    await link();
    await stitch(1, 0);
    await tick(500);

    expect(flushedEvents()).toEqual([expect.objectContaining({ sessionId: REMOTE, kind: 'stitch_action' })]);
  });
});

describe('the first pull after the link', () => {
  test('paints the cells another device stitched', async () => {
    await open();
    const rendererState = hook.rendererState as RendererState;
    rendererState.checkAndClearCompletedDirty(0, 0);
    mockSyncSession.mockImplementationOnce(async (_id, _remote, _device, completed: Uint8Array) => {
      completed[0] = 1;
      return { ...noChanges(), changedCells: [0] };
    });

    await link();

    expect(rendererState.isCompleted(0, 0)).toBe(true);
    expect(rendererState.checkAndClearCompletedDirty(0, 0)).toBe(true);
    expect(hook.completedCellsCount).toBe(1);
    expect(hook.syncTick).toBe(1);
  });
});

describe('completing after the link', () => {
  test('an account completes on the server under the remote id', async () => {
    await open();
    await link();

    await stitch(0, 0);
    await stitch(1, 0);
    await stitch(0, 1);
    await tick(0);

    expect(mockDb.updateSessionStatus).toHaveBeenCalledWith(LOCAL, 'completed', expect.any(String));
    expect(mockCompleteSession).toHaveBeenCalledWith(REMOTE, 'device-1');
    expect(mockQueueClaim).not.toHaveBeenCalled();
  });

  test('a Guest claims with the stitchable cells, not the grid size', async () => {
    mockIdentity.isAccount = false;
    await open();
    await link();

    await stitch(0, 0);
    await stitch(1, 0);
    await stitch(0, 1);
    await tick(0);

    expect(mockQueueClaim).toHaveBeenCalledWith(
      { localSessionId: LOCAL, remoteSessionId: REMOTE, deviceId: 'device-1', completedCells: 3 },
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ sessionId: REMOTE, kind: 'stitch_action' })]),
      expect.any(Number),
    );
    expect(mockCompleteSession).not.toHaveBeenCalled();
  });
});

describe('reopening a linked row', () => {
  test('keeps counting above its local checkpoint, so the Play tab keeps moving', async () => {
    mockDb.getSession.mockImplementation(async () => row({ remoteSessionId: REMOTE }));
    mockDb.getSyncSnapshot.mockResolvedValue({ packedBitmap: 'AA==', serverRevision: 5 });
    mockDb.getLatestCheckpoint.mockResolvedValue({ revision: 40, packedBitmap: 'AA==' });
    await open();

    await stitch(0, 0);
    await tick(4_000);
    await act(async () => {
      renderer?.unmount();
    });
    renderer = undefined;

    expect(flushedOps()[0].baseRevision).toBe(40);
    expect(mockDb.saveCheckpoint).toHaveBeenLastCalledWith(LOCAL, 41, expect.any(Uint8Array));
  });
});
