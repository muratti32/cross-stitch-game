import {
  buildGuestCapture,
  canonicalJson,
  computeManifestChecksum,
  firstCompletionSourceKey,
  type GuestLocalSnapshot,
} from '../manifest';
import { isManifestEmpty } from '../handoff';
import type { StitchingSession } from '../../local-db';
import { GUEST_ID, manifest, PATTERN_A, PATTERN_B, SESSION_A } from './fixtures';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_algorithm: string, data: string) =>
    (require('crypto') as typeof import('crypto')).createHash('sha256').update(data).digest('hex'),
  ),
}));
jest.mock('../../local-db', () => ({
  getLatestCheckpoint: jest.fn(),
  getLocalPatternLikes: jest.fn(),
  getPendingGuestCompletionClaims: jest.fn(),
  getProgressOps: jest.fn(),
  readSessionPackedProgress: jest.fn(),
  getSessions: jest.fn(),
  openNamespace: jest.fn(),
}));

function session(overrides: Partial<StitchingSession> = {}): StitchingSession {
  return {
    id: 'session_local_1',
    patternId: PATTERN_A,
    source: 'catalog',
    artifactChecksum: 'artifact',
    createdAt: '2026-02-01T09:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
    status: 'completed',
    completedAt: '2026-02-01T10:00:00.000Z',
    remoteSessionId: SESSION_A,
    ...overrides,
  };
}

function snapshot(overrides: Partial<GuestLocalSnapshot> = {}): GuestLocalSnapshot {
  return {
    sessions: [session()],
    claims: [],
    likes: { [PATTERN_B]: true },
    progressVersions: { session_local_1: { deviceSeq: 7, opCount: 3, checkpointRevision: 2 } },
    packedProgress: { session_local_1: { packedBitmapBase64: 'Bw==', completedCount: 3 } },
    ...overrides,
  };
}

describe('canonicalJson and manifest checksum', () => {
  test('is independent of key order at every depth', () => {
    const a = { z: 1, a: { y: [1, { b: 2, a: 1 }], x: null } };
    const b = { a: { x: null, y: [1, { a: 1, b: 2 }] }, z: 1 };

    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"x":null,"y":[1,{"a":1,"b":2}]},"z":1}');
  });

  test('the checksum is stable for equal manifests built in a different order', async () => {
    const one = manifest({ likes: { [PATTERN_A]: true, [PATTERN_B]: true } });
    const two = manifest({ likes: { [PATTERN_B]: true, [PATTERN_A]: true } });

    expect(await computeManifestChecksum(one)).toBe(await computeManifestChecksum(two));
    expect(await computeManifestChecksum(one)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('any changed record changes the checksum', async () => {
    const before = await computeManifestChecksum(manifest());

    expect(await computeManifestChecksum(manifest({ likes: {} }))).not.toBe(before);
    expect(
      await computeManifestChecksum(manifest({ progress: { [SESSION_A]: { deviceSeq: 5, checksum: 'sum' } } })),
    ).not.toBe(before);
  });
});

describe('buildGuestCapture', () => {
  test('captures sessions the backend knows, their completions, Likes and drain targets', async () => {
    const capture = await buildGuestCapture(GUEST_ID, snapshot());

    expect(Object.keys(capture.manifest.progress)).toEqual([SESSION_A]);
    expect(capture.manifest.progress[SESSION_A].deviceSeq).toBe(7);
    expect(capture.manifest.completions).toEqual({ [PATTERN_A]: '2026-02-01T10:00:00.000Z' });
    expect(capture.manifest.likes).toEqual({ [PATTERN_B]: true });
    expect(capture.drain).toEqual({
      likes: [PATTERN_B],
      sessions: [{ guestSessionId: SESSION_A, patternId: PATTERN_A, serverKnown: true }],
    });
    expect(capture.sessions).toEqual([
      expect.objectContaining({
        key: SESSION_A,
        localSessionId: 'session_local_1',
        remoteSessionId: SESSION_A,
        source: 'catalog',
        packedBitmapBase64: 'Bw==',
      }),
    ]);
    expect(capture.manifestChecksum).toBe(await computeManifestChecksum(capture.manifest));
  });

  test('a Guest with only a bundled session in progress gets a non-empty manifest and a local-only target', async () => {
    const capture = await buildGuestCapture(
      GUEST_ID,
      snapshot({
        sessions: [session({ id: 'bundled_1', patternId: 'starter_heart', source: 'bundled', remoteSessionId: null, status: 'active', completedAt: null })],
        likes: {},
        progressVersions: {},
        packedProgress: { bundled_1: { packedBitmapBase64: 'Bw==', completedCount: 3 } },
      }),
    );

    expect(isManifestEmpty(capture.manifest)).toBe(false);
    expect(Object.keys(capture.manifest.progress)).toEqual(['bundled_1']);
    expect(capture.drain.sessions).toEqual([{ guestSessionId: 'bundled_1', patternId: 'starter_heart', serverKnown: false }]);
    expect(capture.sessions).toEqual([
      expect.objectContaining({ key: 'bundled_1', localSessionId: 'bundled_1', remoteSessionId: null, source: 'bundled', packedBitmapBase64: 'Bw==' }),
    ]);
  });

  test('a completed local session is carried even with no folded progress', async () => {
    const capture = await buildGuestCapture(
      GUEST_ID,
      snapshot({
        sessions: [session({ id: 'bundled_1', patternId: 'starter_heart', source: 'bundled', remoteSessionId: null })],
        packedProgress: {},
      }),
    );

    expect(capture.manifest.completions).toEqual({ starter_heart: '2026-02-01T10:00:00.000Z' });
    expect(capture.drain.sessions).toEqual([{ guestSessionId: 'bundled_1', patternId: 'starter_heart', serverKnown: false }]);
  });

  test('leaves out untouched local sessions and Likes that are off', async () => {
    const capture = await buildGuestCapture(
      GUEST_ID,
      snapshot({
        sessions: [session({ id: 'bundled_1', patternId: 'starter_heart', source: 'bundled', remoteSessionId: null, status: 'ready', completedAt: null })],
        likes: { [PATTERN_A]: false },
        packedProgress: { bundled_1: { packedBitmapBase64: '', completedCount: 0 } },
      }),
    );

    expect(capture.manifest).toEqual({ progress: {}, completions: {}, pendingRewards: {}, likes: {} });
    expect(capture.drain).toEqual({ likes: [], sessions: [] });
    expect(capture.sessions).toEqual([]);
  });

  test('a server-known session with no progress is still drained', async () => {
    const capture = await buildGuestCapture(GUEST_ID, snapshot({ packedProgress: {} }));

    expect(capture.drain.sessions).toEqual([{ guestSessionId: SESSION_A, patternId: PATTERN_A, serverKnown: true }]);
    expect(capture.sessions[0].packedBitmapBase64).toBe('');
  });

  test('a claim on a session the backend does not know earns no pending reward', async () => {
    const capture = await buildGuestCapture(
      GUEST_ID,
      snapshot({
        sessions: [session({ id: 'bundled_1', patternId: 'starter_heart', source: 'bundled', remoteSessionId: null })],
        claims: [{ localSessionId: 'bundled_1', remoteSessionId: SESSION_A, deviceId: 'device', completedCells: 9 }],
      }),
    );

    expect(capture.manifest.pendingRewards).toEqual({});
  });

  test('turns a pending guest completion claim into a first-completion source key', async () => {
    const capture = await buildGuestCapture(
      GUEST_ID,
      snapshot({
        claims: [{ localSessionId: 'session_local_1', remoteSessionId: SESSION_A, deviceId: 'device', completedCells: 900 }],
      }),
    );

    const key = firstCompletionSourceKey(GUEST_ID, PATTERN_A);
    expect(key).toBe(`first_completion:guest:${GUEST_ID}:${PATTERN_A}`);
    expect(capture.manifest.pendingRewards).toEqual({
      [key]: {
        localSessionId: 'session_local_1',
        remoteSessionId: SESSION_A,
        patternId: PATTERN_A,
        completedAt: '2026-02-01T10:00:00.000Z',
        completedCells: 900,
      },
    });
  });

  test('the same local records always produce the same checksum', async () => {
    const first = await buildGuestCapture(GUEST_ID, snapshot());
    const second = await buildGuestCapture(GUEST_ID, snapshot());

    expect(second.manifestChecksum).toBe(first.manifestChecksum);
  });

  test('a changed local record changes the checksum', async () => {
    const first = await buildGuestCapture(GUEST_ID, snapshot());
    const second = await buildGuestCapture(
      GUEST_ID,
      snapshot({ progressVersions: { session_local_1: { deviceSeq: 8, opCount: 4, checkpointRevision: 2 } } }),
    );

    expect(second.manifestChecksum).not.toBe(first.manifestChecksum);
  });

  test('changed cells change the checksum, so the package is bound to the manifest', async () => {
    const first = await buildGuestCapture(GUEST_ID, snapshot());
    const second = await buildGuestCapture(
      GUEST_ID,
      snapshot({ packedProgress: { session_local_1: { packedBitmapBase64: 'Dw==', completedCount: 4 } } }),
    );

    expect(second.manifestChecksum).not.toBe(first.manifestChecksum);
  });

  test('keeps the latest completion when a Pattern was finished twice', async () => {
    const capture = await buildGuestCapture(
      GUEST_ID,
      snapshot({
        sessions: [
          session({ completedAt: '2026-02-01T10:00:00.000Z' }),
          session({
            id: 'session_local_2',
            remoteSessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            completedAt: '2026-03-01T10:00:00.000Z',
          }),
        ],
      }),
    );

    expect(capture.manifest.completions[PATTERN_A]).toBe('2026-03-01T10:00:00.000Z');
  });
});

describe('a linked completed row and an unlinked replay on one pattern', () => {
  test('both are packaged, keyed by the remote id and the local id, with their own bitmaps', async () => {
    const replay = session({
      id: 'session_local_2',
      status: 'ready',
      completedAt: null,
      remoteSessionId: null,
      createdAt: '2026-02-02T09:00:00.000Z',
      updatedAt: '2026-02-02T10:00:00.000Z',
    });
    const capture = await buildGuestCapture(
      GUEST_ID,
      snapshot({
        sessions: [session(), replay],
        progressVersions: {
          session_local_1: { deviceSeq: 7, opCount: 3, checkpointRevision: 2 },
          session_local_2: { deviceSeq: 9, opCount: 1, checkpointRevision: 0 },
        },
        packedProgress: {
          session_local_1: { packedBitmapBase64: 'Bw==', completedCount: 3 },
          session_local_2: { packedBitmapBase64: 'AQ==', completedCount: 1 },
        },
      }),
    );

    expect(Object.keys(capture.manifest.progress).sort()).toEqual([SESSION_A, 'session_local_2'].sort());
    const byKey = Object.fromEntries(capture.sessions.map((entry) => [entry.key, entry]));
    expect(byKey[SESSION_A].packedBitmapBase64).toBe('Bw==');
    expect(byKey['session_local_2']).toMatchObject({ remoteSessionId: null, localSessionId: 'session_local_2', packedBitmapBase64: 'AQ==' });
  });
});
