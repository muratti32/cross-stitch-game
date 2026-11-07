import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { createNodeSqliteFiles, nodeSqliteAvailable } from '../../local-db/__tests__/nodeSqliteDatabase';

const mockDatabases = createNodeSqliteFiles();
const mockIdentity = { isAccount: true };
const mockSyncProgress = jest.fn();
const mockCompleteProgress = jest.fn();
const mockLoadBundledPattern = jest.fn();

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async (filename: string) => mockDatabases.open(filename)) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('../../api/progressSync', () => ({
  ProgressSyncError: class extends Error {},
  syncProgress: (...args: unknown[]) => mockSyncProgress(...args),
  completeProgress: (...args: unknown[]) => mockCompleteProgress(...args),
}));
jest.mock('../../providers', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../../sync/bundledSessionRegistrar', () => ({ subscribeBundledSessionLinked: () => () => undefined }));
jest.mock('../../sync/gameplayEventEngine', () => ({ flushGameplayEventsAndCompletionClaims: async () => undefined }));
jest.mock('../../sync/guestCompletionClaimEngine', () => ({ queueGuestCompletionClaim: async () => undefined }));
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

import { useStitchingSession } from '../useStitchingSession';
import {
  adoptPromotedSession,
  createSession,
  getSessionCompletedCount,
  getUnackedProgressOps,
  insertProgressOpsBatch,
  openNamespace,
  saveCheckpoint,
  saveSyncSnapshot,
} from '../../local-db';
import { packCompletedBitmap, uint8ArrayToBase64 } from '../../local-db/helpers';
import type { OutgoingProgressOperation } from '../../api/progressSync';
import type { PackagedSession } from '../../api/promotionContract';

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const REMOTE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HEART = 'dc47c329-35fd-4173-9ad9-5098369beb44';
const META = { title: 'Heart', previewUrl: null, thumbnailUrl: null, width: 2, height: 2 };
const PATTERN = {
  width: 2,
  height: 2,
  grid: new Uint8Array([1, 1, 1, 0]),
  palette: [{ dmcCode: '321', name: 'Red', rgbHex: '#cc0000' }],
};

type Hook = ReturnType<typeof useStitchingSession>;

let hook: Hook;
let renderer: TestRenderer.ReactTestRenderer | undefined;
let serverCells: Set<number>;
let serverRevision: number;
let serverSeqs: Set<number>;

function Harness({ sessionId }: { sessionId: string }) {
  hook = useStitchingSession(sessionId);
  return null;
}

async function open(sessionId: string): Promise<void> {
  await act(async () => {
    renderer = TestRenderer.create(<Harness sessionId={sessionId} />);
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

async function exit(): Promise<void> {
  await act(async () => {
    renderer?.unmount();
    await jest.advanceTimersByTimeAsync(0);
  });
  renderer = undefined;
}

async function flushBuffer(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
}

async function stitch(x: number, y: number): Promise<void> {
  await act(async () => {
    hook.stitchCell(x, y, 0);
    await jest.advanceTimersByTimeAsync(0);
  });
}

function cells(...indexes: number[]): Uint8Array {
  const completed = new Uint8Array(4);
  for (const index of indexes) completed[index] = 1;
  return completed;
}

async function linkedRow(...serverHeld: number[]): Promise<string> {
  const { id } = await createSession(HEART, 'bundled', 'bundled', 'active', REMOTE, META);
  await saveSyncSnapshot(id, 5, cells(...serverHeld), false);
  return id;
}

const guestSession = (...guestCells: number[]) =>
  ({
    localSessionId: 'guest_row',
    patternId: HEART,
    source: 'bundled',
    status: 'active',
    packedBitmapBase64: uint8ArrayToBase64(packCompletedBitmap(cells(...guestCells))),
  }) as PackagedSession;

async function serverSync(_remote: string, _device: string, _since: number, operations: OutgoingProgressOperation[]) {
  const acknowledgements = operations.map(({ opId, deviceSeq, desiredState, cellIndex }) => {
    if (serverSeqs.has(deviceSeq)) return { opId, status: 'duplicate' };
    serverSeqs.add(deviceSeq);
    serverRevision += 1;
    if (desiredState === 'completed') serverCells.add(cellIndex);
    else serverCells.delete(cellIndex);
    return { opId, status: 'applied' };
  });
  return { revision: serverRevision, terminalCompleted: false, acknowledgements, operations: [] };
}

(nodeSqliteAvailable ? describe : describe.skip)('a linked session against real SQL', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockDatabases.clear();
    await openNamespace(ACCOUNT);
    serverCells = new Set();
    serverSeqs = new Set();
    serverRevision = 5;
    mockLoadBundledPattern.mockResolvedValue(PATTERN);
    mockSyncProgress.mockImplementation(serverSync);
    mockCompleteProgress.mockImplementation(async () => {
      if (serverCells.size !== 3) throw new Error('409 Session is not fully stitched');
      return { revision: serverRevision, terminalCompleted: true };
    });
  });

  afterEach(async () => {
    if (renderer !== undefined) await exit();
    jest.useRealTimers();
  });

  test('completing uploads every final op before it asks the server to finish', async () => {
    await open(await linkedRow());

    await stitch(0, 0);
    await stitch(1, 0);
    await stitch(0, 1);

    expect(serverCells).toEqual(new Set([0, 1, 2]));
    await expect(mockCompleteProgress.mock.results[0].value).resolves.toMatchObject({ terminalCompleted: true });
  });

  test('an exit right after a stitch keeps the cell, and the next open uploads it', async () => {
    const id = await linkedRow();
    await open(id);
    await stitch(0, 0);

    await exit();
    await open(id);

    expect(hook.rendererState?.isCompleted(0, 0)).toBe(true);
    expect(serverCells).toEqual(new Set([0]));
  });

  test('Guest cells merged into a linked row open, survive an offline exit and reach the server', async () => {
    const id = await linkedRow(0);
    await saveCheckpoint(id, 4, cells(0));
    await adoptPromotedSession(guestSession(1, 2), null);

    mockSyncProgress.mockRejectedValue(new Error('Network request failed'));
    await open(id);

    expect(hook.completedCellsCount).toBe(3);

    await exit();

    expect(await getSessionCompletedCount(id, 2, 2)).toBe(3);

    mockSyncProgress.mockImplementation(serverSync);
    await open(id);

    expect(serverCells).toEqual(new Set([1, 2]));
    expect(hook.completedCellsCount).toBe(3);
  });

  describe('a merge that lands while the session is open', () => {
    beforeEach(async () => {
      mockSyncProgress.mockRejectedValue(new Error('Network request failed'));
      await open(await linkedRow());
    });

    async function finishOnline(): Promise<void> {
      await stitch(0, 1);
      mockSyncProgress.mockImplementation(serverSync);
      await stitch(1, 0);
    }

    test('stitches after it take seqs above the merged ops, so the server can finish', async () => {
      await stitch(0, 0);
      await flushBuffer();
      await adoptPromotedSession(guestSession(1), null);

      await finishOnline();

      expect(serverCells).toEqual(new Set([0, 1, 2]));
      await expect(mockCompleteProgress.mock.results[0].value).resolves.toMatchObject({ terminalCompleted: true });
    });

    test('a stitch still in the flush buffer takes a seq above them too', async () => {
      await stitch(0, 0);
      await adoptPromotedSession(guestSession(1), null);
      await flushBuffer();

      await finishOnline();

      expect(serverCells).toEqual(new Set([0, 1, 2]));
      await expect(mockCompleteProgress.mock.results[0].value).resolves.toMatchObject({ terminalCompleted: true });
    });
  });

  describe('a backlog larger than one sync', () => {
    const OVER_ONE_SYNC = 501;
    const OFFLINE = new Error('Network request failed');
    beforeEach(async () => {
      mockSyncProgress.mockRejectedValue(OFFLINE);
      const id = await linkedRow();
      await insertProgressOpsBatch(
        Array.from({ length: OVER_ONE_SYNC }, (_, index) => ({
          opId: `backlog-${index}`,
          sessionId: id,
          deviceId: 'device',
          cellIndex: 3,
          desiredState: 'incomplete' as const,
          baseRevision: 0,
          createdAt: '2026-02-01T10:00:00.000Z',
        })),
      );
      await open(id);
      await stitch(0, 0);
      await stitch(1, 0);
    });

    test('drains before it asks the server to finish', async () => {
      mockSyncProgress.mockImplementation(serverSync);

      await stitch(0, 1);

      expect(mockSyncProgress.mock.calls.at(-1)?.[3]).toHaveLength(4);
      expect(await getUnackedProgressOps(hook.session?.id ?? '')).toEqual([]);
      await expect(mockCompleteProgress.mock.results[0].value).resolves.toMatchObject({ terminalCompleted: true });
    });

    test('a drain that fails partway still asks once, and stops uploading', async () => {
      mockSyncProgress.mockImplementationOnce(serverSync).mockRejectedValue(OFFLINE);
      const uploadsBefore = mockSyncProgress.mock.calls.length;

      await stitch(0, 1);

      expect(mockSyncProgress.mock.calls.length - uploadsBefore).toBe(2);
      expect(mockCompleteProgress).toHaveBeenCalledTimes(1);
      await expect(mockCompleteProgress.mock.results[0].value).rejects.toThrow('409');
    });

    test('a sync already in flight is waited for, not skipped', async () => {
      let release: () => void = () => undefined;
      mockSyncProgress.mockImplementation(serverSync);
      mockSyncProgress.mockImplementationOnce(async (...args: Parameters<typeof serverSync>) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return serverSync(...args);
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000);
      });

      await stitch(0, 1);
      expect(mockCompleteProgress).not.toHaveBeenCalled();

      release();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });

      await expect(mockCompleteProgress.mock.results[0].value).resolves.toMatchObject({ terminalCompleted: true });
    });
  });
});
