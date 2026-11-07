import type { PackagedSession } from '../../api/promotionContract';
import { planPromotedSessionAdoption, type PromotedSessionServerState } from '../promotedSessionAdoption';

function packaged(overrides: Partial<PackagedSession> = {}): PackagedSession {
  return {
    key: 'bundled_1',
    localSessionId: 'bundled_1',
    remoteSessionId: null,
    patternId: 'starter_heart',
    source: 'bundled',
    artifactChecksum: 'artifact',
    status: 'active',
    createdAt: '2026-02-01T09:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
    completedAt: null,
    replayOf: null,
    title: null,
    previewUrl: null,
    thumbnailUrl: null,
    patternWidth: 4,
    patternHeight: 4,
    packedBitmapBase64: 'Bw==',
    ...overrides,
  };
}

const server = (overrides: Partial<PromotedSessionServerState> = {}): PromotedSessionServerState => ({
  accountSessionId: 'remote-1',
  revision: 42,
  packedBitmapBase64: 'Dw==',
  terminalCompleted: false,
  ...overrides,
});

const noRows = { alreadyAdopted: false, activeSessionId: null };

describe('planPromotedSessionAdoption', () => {
  test('a session still preparing lands ready, since no download runs under the account', () => {
    expect(planPromotedSessionAdoption(packaged({ status: 'preparing' }), server(), noRows)).toMatchObject({
      kind: 'insert',
      status: 'ready',
    });
  });

  test('a row that already holds the session wins, whatever the server says', () => {
    expect(planPromotedSessionAdoption(packaged(), server(), { alreadyAdopted: true, activeSessionId: 'a' })).toEqual({
      kind: 'keepAccountRow',
    });
    expect(planPromotedSessionAdoption(packaged(), null, { alreadyAdopted: true, activeSessionId: 'a' })).toEqual({
      kind: 'keepAccountRow',
    });
  });

  test('a local-only session with no active account session becomes a local-only row', () => {
    expect(planPromotedSessionAdoption(packaged(), null, noRows)).toEqual({
      kind: 'insert',
      remoteSessionId: null,
      status: 'active',
      completedAt: null,
      packedBitmapBase64: 'Bw==',
      syncSnapshot: null,
    });
  });

  test('two active local sessions on one pattern merge into the account session', () => {
    expect(planPromotedSessionAdoption(packaged(), null, { alreadyAdopted: false, activeSessionId: 'account_row' })).toEqual({
      kind: 'mergeIntoActive',
      sessionId: 'account_row',
      packedBitmapBase64: 'Bw==',
    });
  });

  test('a completed local session stays history beside the active account session', () => {
    const completed = packaged({ status: 'completed', completedAt: '2026-02-01T10:00:00.000Z' });

    expect(planPromotedSessionAdoption(completed, null, { alreadyAdopted: false, activeSessionId: 'account_row' })).toMatchObject({
      kind: 'insert',
      status: 'completed',
      completedAt: '2026-02-01T10:00:00.000Z',
    });
  });

  test('a drained session is seeded from the server, never from the packaged bitmap', () => {
    expect(planPromotedSessionAdoption(packaged({ source: 'catalog' }), server(), noRows)).toEqual({
      kind: 'insert',
      remoteSessionId: 'remote-1',
      status: 'active',
      completedAt: null,
      packedBitmapBase64: 'Dw==',
      syncSnapshot: { serverRevision: 42, terminal: false },
    });
  });

  test('a drained session never merges locally: the backend already did', () => {
    expect(planPromotedSessionAdoption(packaged(), server(), { alreadyAdopted: false, activeSessionId: 'other' })).toMatchObject({
      kind: 'insert',
      remoteSessionId: 'remote-1',
    });
  });

  test('a terminal server session lands completed', () => {
    expect(planPromotedSessionAdoption(packaged(), server({ terminalCompleted: true }), noRows)).toMatchObject({
      status: 'completed',
      completedAt: '2026-02-01T10:00:00.000Z',
      syncSnapshot: { serverRevision: 42, terminal: true },
    });
  });

  test('with no surviving server session the local cells are kept as a local-only row', () => {
    expect(
      planPromotedSessionAdoption(packaged(), server({ accountSessionId: null, packedBitmapBase64: null, revision: 0 }), noRows),
    ).toMatchObject({ kind: 'insert', remoteSessionId: null, packedBitmapBase64: 'Bw==', syncSnapshot: null });
  });

  test.each([null, ''])('a server bitmap of %j seeds no snapshot, so the first sync pulls from revision 0', (bitmap) => {
    expect(planPromotedSessionAdoption(packaged(), server({ packedBitmapBase64: bitmap }), noRows)).toMatchObject({
      remoteSessionId: 'remote-1',
      packedBitmapBase64: 'Bw==',
      syncSnapshot: null,
    });
  });
});
