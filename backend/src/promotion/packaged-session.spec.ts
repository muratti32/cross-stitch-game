import { packCompletedCells, parsePackagedSessions, unpackCompletedCells } from './packaged-session';

const session = {
  key: 'session-1',
  localSessionId: 'local-1',
  remoteSessionId: null,
  patternId: 'starter_cat',
  source: 'bundled',
  artifactChecksum: 'checksum',
  status: 'active',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T11:00:00.000Z',
  completedAt: null,
  replayOf: null,
  title: null,
  previewUrl: null,
  thumbnailUrl: null,
  patternWidth: 2,
  patternHeight: 2,
  packedBitmapBase64: 'BQ==',
};

describe('parsePackagedSessions', () => {
  it('reads an app-packaged session', () => {
    expect(parsePackagedSessions({ manifest: {}, sessions: [session] })).toEqual([
      { key: 'session-1', status: 'active', completedAt: null, packedBitmapBase64: 'BQ==' },
    ]);
  });

  it('treats a package without sessions as an older client', () => {
    expect(parsePackagedSessions({ manifest: {} })).toEqual([]);
  });

  it('accepts an empty bitmap and a completed session', () => {
    const completed = { ...session, status: 'completed', completedAt: '2026-11-01T12:00:00.000Z', packedBitmapBase64: '' };
    expect(parsePackagedSessions({ sessions: [completed] })).toEqual([
      { key: 'session-1', status: 'completed', completedAt: '2026-11-01T12:00:00.000Z', packedBitmapBase64: '' },
    ]);
  });

  it.each([
    ['sessions is not an array', { sessions: { 0: session } }],
    ['a session is not an object', { sessions: ['session-1'] }],
    ['the key is missing', { sessions: [{ ...session, key: undefined }] }],
    ['the key is empty', { sessions: [{ ...session, key: '' }] }],
    ['the status is unknown', { sessions: [{ ...session, status: 'abandoned' }] }],
    ['the bitmap is missing', { sessions: [{ ...session, packedBitmapBase64: undefined }] }],
    ['the bitmap is not base64', { sessions: [{ ...session, packedBitmapBase64: 'not base64!' }] }],
    ['the bitmap has a truncated base64 length', { sessions: [{ ...session, packedBitmapBase64: 'BQ=' }] }],
    ['the bitmap is over the size cap', { sessions: [{ ...session, packedBitmapBase64: 'A'.repeat(1_400_000) }] }],
    ['completedAt is not a date', { sessions: [{ ...session, completedAt: 'yesterday' }] }],
    ['completedAt is missing', { sessions: [{ ...session, completedAt: undefined }] }],
  ])('rejects a package when %s', (_label, packageData) => {
    expect(parsePackagedSessions(packageData)).toBeNull();
  });

  it('rejects the whole package when one session is malformed', () => {
    expect(parsePackagedSessions({ sessions: [session, { ...session, status: 'abandoned' }] })).toBeNull();
  });
});

describe('packed bitmaps', () => {
  it('reads bits least significant first', () => {
    expect(unpackCompletedCells(Buffer.from([0b0000_0101, 0b0000_0010]), 16)).toEqual([0, 2, 9]);
  });

  it('ignores bits at or beyond the cell count', () => {
    expect(unpackCompletedCells(Buffer.from([0b1111_1111]), 3)).toEqual([0, 1, 2]);
  });

  it('reads a bitmap shorter than the cell count', () => {
    expect(unpackCompletedCells(Buffer.from([0b0000_0001]), 100)).toEqual([0]);
  });

  it('packs the same format it reads', () => {
    expect(packCompletedCells([0, 2, 9], 16)).toEqual(Buffer.from([0b0000_0101, 0b0000_0010]));
    expect(unpackCompletedCells(packCompletedCells([1, 8, 10], 11), 11)).toEqual([1, 8, 10]);
  });

  it('sizes the bitmap from the cell count and drops cells beyond it', () => {
    expect(packCompletedCells([0, 9], 9)).toEqual(Buffer.from([0b0000_0001, 0]));
  });
});
