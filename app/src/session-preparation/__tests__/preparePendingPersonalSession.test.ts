import { preparePendingPersonalSession, uint8ArrayToBase64, base64ToUint8Array, getOfflinePatternPath } from '../index';
import { decodePatternArtifact } from '../../pattern-artifact';
import type { PendingPersonalPattern } from '../../local-db';

jest.mock('../../local-db', () => ({
  createSession: jest.fn(),
  findActiveSessionForPattern: jest.fn(),
  getActiveIdentity: jest.fn(() => 'guest123'),
}));

const writtenFiles: Record<string, string> = {};
const madeDirectories: string[] = [];

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/docs/',
  makeDirectoryAsync: jest.fn(async (path: string) => {
    madeDirectories.push(path);
  }),
  writeAsStringAsync: jest.fn(async (path: string, content: string) => {
    writtenFiles[path] = content;
  }),
  EncodingType: { Base64: 'base64' },
}));

const localDb = require('../../local-db');

describe('preparePendingPersonalSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(writtenFiles)) delete writtenFiles[key];
    madeDirectories.length = 0;
  });

  const grid = new Uint8Array([0, 1, 1, 0]);
  const palette = [{ dmcCode: '310', name: 'Black', rgbHex: '#000000' }];
  const pending: PendingPersonalPattern = {
    patternId: 'pat_1',
    sourcePatternId: 'src_1',
    title: 'My Draft',
    width: 2,
    height: 2,
    palette,
    gridBase64: uint8ArrayToBase64(grid),
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  test('resumes an existing active session without touching the filesystem', async () => {
    const existing = {
      id: 'session_existing',
      patternId: 'pat_1',
      source: 'personal',
      artifactChecksum: 'chk',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'ready',
    };
    localDb.findActiveSessionForPattern.mockResolvedValue(existing);

    const result = await preparePendingPersonalSession(pending);

    expect(result).toBe(existing);
    expect(localDb.createSession).not.toHaveBeenCalled();
    expect(Object.keys(writtenFiles)).toHaveLength(0);
  });

  test('encodes the pending grid+palette into a decodable artifact and creates a ready local-only session', async () => {
    localDb.findActiveSessionForPattern.mockResolvedValue(null);
    const created = {
      id: 'session_new',
      patternId: 'pat_1',
      source: 'personal',
      artifactChecksum: 'computed',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'ready',
    };
    localDb.createSession.mockResolvedValue(created);

    const result = await preparePendingPersonalSession(pending);

    expect(result).toBe(created);
    expect(localDb.findActiveSessionForPattern).toHaveBeenCalledWith('pat_1', 'personal');

    // createSession must be called with a real SHA-256 checksum of the written bytes,
    // status 'ready', no remoteSessionId, and the pending record's display metadata.
    expect(localDb.createSession).toHaveBeenCalledTimes(1);
    const [patternIdArg, checksumArg, sourceArg, statusArg, remoteSessionIdArg, metaArg] =
      localDb.createSession.mock.calls[0];
    expect(patternIdArg).toBe('pat_1');
    expect(sourceArg).toBe('personal');
    expect(statusArg).toBe('ready');
    expect(remoteSessionIdArg).toBeNull();
    expect(metaArg).toEqual({
      title: 'My Draft',
      previewUrl: null,
      width: 2,
      height: 2,
    });

    const destPath = getOfflinePatternPath('pat_1', 'guest123');
    expect(madeDirectories).toEqual([destPath.substring(0, destPath.lastIndexOf('/'))]);
    expect(Object.keys(writtenFiles)).toEqual([destPath]);

    // Round-trip: the bytes actually written to disk must decode back to the
    // exact grid/palette that was passed in, under the checksum createSession
    // was given — this is the same verification useStitchingSession.ts performs
    // when it later loads this file to start gameplay.
    const writtenBytesBase64 = writtenFiles[destPath];
    const writtenBytes = base64ToUint8Array(writtenBytesBase64);
    const decoded = decodePatternArtifact(writtenBytes, checksumArg);
    expect(decoded.schemaVersion).toBe(1);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.palette).toEqual(palette);
    expect(Array.from(decoded.grid)).toEqual(Array.from(grid));
  });
});
