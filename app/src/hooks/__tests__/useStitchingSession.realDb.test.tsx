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

(nodeSqliteAvailable ? describe : describe.skip)('a linked session against real SQL', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockDatabases.clear();
    await openNamespace(ACCOUNT);
    serverCells = new Set();
    serverRevision = 5;
    mockLoadBundledPattern.mockResolvedValue(PATTERN);
    mockSyncProgress.mockImplementation(
      async (_remote: string, _device: string, _since: number, operations: OutgoingProgressOperation[]) => {
        for (const operation of operations) {
          serverRevision += 1;
          if (operation.desiredState === 'completed') serverCells.add(operation.cellIndex);
          else serverCells.delete(operation.cellIndex);
        }
        return {
          revision: serverRevision,
          terminalCompleted: false,
          acknowledgements: operations.map(({ opId }) => ({ opId, status: 'applied' })),
          operations: [],
        };
      },
    );
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

    const online = mockSyncProgress.getMockImplementation();
    mockSyncProgress.mockRejectedValue(new Error('Network request failed'));
    await open(id);

    expect(hook.completedCellsCount).toBe(3);

    await exit();

    expect(await getSessionCompletedCount(id, 2, 2)).toBe(3);

    mockSyncProgress.mockImplementation(online);
    await open(id);

    expect(serverCells).toEqual(new Set([1, 2]));
    expect(hook.completedCellsCount).toBe(3);
  });
});
