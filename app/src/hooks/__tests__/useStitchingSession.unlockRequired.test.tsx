import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { useStitchingSession } from '../useStitchingSession';
import { retryDownload, UnlockRequiredError } from '../../session-preparation';

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: async () => ({ exists: false }),
  readAsStringAsync: async () => '',
  EncodingType: { Base64: 'base64' },
}));
jest.mock('../../local-db', () => ({
  initDatabase: async () => undefined,
  getDeviceId: async () => 'device-1',
  getGameplaySeqHigh: async () => 0,
  setGameplaySeqHigh: async () => undefined,
  updateSessionError: async () => undefined,
  getActiveIdentity: () => 'account-1',
  unpackCompletedBitmap: (_packed: string, length: number) => new Uint8Array(length),
  getSession: async () => ({
    id: 'session_local',
    patternId: 'pattern-1',
    source: 'catalog',
    status: 'ready',
    remoteSessionId: 'remote-1',
    artifactChecksum: 'chk',
  }),
  getProgressOps: async () => [],
  getUnackedProgressOps: async () => [],
  getLatestCheckpoint: async () => null,
  getSyncSnapshot: async () => null,
  insertProgressOpsBatch: async () => undefined,
  insertGameplayEventsBatch: async () => undefined,
  saveCheckpoint: async () => undefined,
  updateSessionStatus: async () => undefined,
}));
jest.mock('../../sync/bundledSessionRegistrar', () => ({
  subscribeBundledSessionLinked: () => () => undefined,
}));
jest.mock('../../sync/progressSyncEngine', () => ({
  syncSession: jest.fn(),
  completeSession: jest.fn(),
}));
jest.mock('../../sync/gameplayEventEngine', () => ({
  flushGameplayEventsAndCompletionClaims: async () => undefined,
}));
jest.mock('../../sync/guestCompletionClaimEngine', () => ({
  queueGuestCompletionClaim: async () => undefined,
}));
jest.mock('../../bundled-patterns', () => ({ loadBundledPattern: jest.fn() }));
jest.mock('../../session-preparation', () => {
  class UnlockRequiredError extends Error {
    patternId: string;
    price: number;
    constructor(patternId: string, price: number) {
      super('unlock_required');
      this.patternId = patternId;
      this.price = price;
    }
  }
  return {
    UnlockRequiredError,
    base64ToUint8Array: () => new Uint8Array(),
    deleteOfflinePatternFile: jest.fn(),
    getOfflinePatternPath: () => '/missing.bin',
    retryDownload: jest.fn(),
    waitUntilSessionReady: jest.fn(),
  };
});
jest.mock('../../pattern-artifact', () => ({ decodePatternArtifact: jest.fn() }));
jest.mock('../../renderer', () => ({
  RendererState: jest.requireActual('../../renderer/RendererState').RendererState,
}));
jest.mock('../../../modules/perf-thermal', () => ({ getDeviceRenderingProfile: () => 'standard' }));
jest.mock('../../identity/guestIdentity', () => ({
  useIdentityStore: { getState: () => ({ isAccount: true }) },
}));
jest.mock('../../onboarding/tutorialEvents', () => ({ emitTutorialEvent: async () => undefined }));
jest.mock('../../analytics/gameplayEvents', () => ({
  captureGameplayEvent: async () => undefined,
  captureSessionGameplayEvent: async () => undefined,
}));
jest.mock('../../api/progressSync', () => ({ ProgressSyncError: class extends Error {} }));

type Hook = ReturnType<typeof useStitchingSession>;
let hook: Hook;

function Harness() {
  hook = useStitchingSession('session_local');
  return null;
}

test('an unlock_required refresh while reopening a purged pattern exposes the unlock state', async () => {
  jest.mocked(retryDownload).mockRejectedValue(new UnlockRequiredError('pattern-1', 75));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);

  let renderer: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<Harness />);
  });

  expect(hook.unlockRequired).toMatchObject({ patternId: 'pattern-1', price: 75 });
  expect(hook.loading).toBe(false);
  await act(async () => {
    renderer?.unmount();
  });
});
