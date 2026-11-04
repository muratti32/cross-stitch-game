import {
  buildGuestCapture,
  canonicalJson,
  computeManifestChecksum,
  firstCompletionSourceKey,
  type GuestLocalSnapshot,
} from '../manifest';
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
      sessions: [{ guestSessionId: SESSION_A, patternId: PATTERN_A }],
    });
    expect(capture.manifestChecksum).toBe(await computeManifestChecksum(capture.manifest));
  });

  test('leaves out sessions with no remote id and Likes that are off', async () => {
    const capture = await buildGuestCapture(
      GUEST_ID,
      snapshot({
        sessions: [session({ remoteSessionId: null }), session({ id: 'bundled', patternId: 'bundled_rose', remoteSessionId: null })],
        likes: { [PATTERN_A]: false },
      }),
    );

    expect(capture.manifest).toEqual({ progress: {}, completions: {}, pendingRewards: {}, likes: {} });
    expect(capture.drain).toEqual({ likes: [], sessions: [] });
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
