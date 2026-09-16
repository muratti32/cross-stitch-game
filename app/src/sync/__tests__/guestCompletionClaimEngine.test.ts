import {
  flushPendingGuestCompletionClaims,
  queueGuestCompletionClaim,
} from '../guestCompletionClaimEngine';
import * as localDb from '../../local-db';
import * as api from '../../api/progressSync';
import { queryClient } from '../../providers';

jest.mock('../../local-db', () => ({
  completeGuestSessionWithPendingClaim: jest.fn(),
  getPendingGuestCompletionClaims: jest.fn(),
  resolveGuestCompletionClaim: jest.fn(),
}));

jest.mock('../../api/progressSync', () => {
  const actual = jest.requireActual('../../api/progressSync');
  return {
    ...actual,
    completeProgress: jest.fn(),
  };
});

const mockedDb = jest.mocked(localDb);
const mockedApi = jest.mocked(api);

const claim = {
  localSessionId: 'local-1',
  remoteSessionId: '00000000-0000-4000-8000-000000000001',
  deviceId: '00000000-0000-4000-8000-000000000002',
  completedCells: 4_000,
};

const gameplayEvents = [{
  eventId: 'event-1',
  sessionId: claim.remoteSessionId,
  kind: 'stitch_action' as const,
  dmcCode: '310',
  clientSeq: 9,
  occurredAt: '2026-09-16T10:00:00.000Z',
}];

describe('Guest completion claim outbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('durably records local completion before attempting delivery', async () => {
    mockedDb.completeGuestSessionWithPendingClaim.mockResolvedValue(undefined);

    await queueGuestCompletionClaim(
      claim,
      '2026-09-16T10:00:00.000Z',
      gameplayEvents,
      9,
    );

    expect(mockedDb.completeGuestSessionWithPendingClaim).toHaveBeenCalledWith(
      claim,
      '2026-09-16T10:00:00.000Z',
      gameplayEvents,
      9,
    );
  });

  it('keeps a network failure pending and resolves it on a later retry', async () => {
    mockedDb.getPendingGuestCompletionClaims.mockResolvedValue([claim]);
    mockedApi.completeProgress
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce({ revision: 0, terminalCompleted: true });
    mockedDb.resolveGuestCompletionClaim.mockResolvedValue(undefined);

    await expect(flushPendingGuestCompletionClaims()).rejects.toThrow(
      'Network request failed',
    );
    expect(mockedDb.resolveGuestCompletionClaim).not.toHaveBeenCalled();

    await expect(flushPendingGuestCompletionClaims()).resolves.toBeUndefined();
    expect(mockedApi.completeProgress).toHaveBeenLastCalledWith(
      claim.remoteSessionId,
      claim.deviceId,
      claim.completedCells,
    );
    expect(mockedDb.resolveGuestCompletionClaim).toHaveBeenCalledWith(
      claim.localSessionId,
      'accepted',
    );
  });

  it('marks a 409 rejected so it is not retried', async () => {
    mockedDb.getPendingGuestCompletionClaims
      .mockResolvedValueOnce([claim])
      .mockResolvedValueOnce([]);
    mockedApi.completeProgress.mockRejectedValueOnce(
      new api.ProgressSyncError('implausible_completion', 409, 'implausible_completion'),
    );
    mockedDb.resolveGuestCompletionClaim.mockResolvedValue(undefined);

    await expect(flushPendingGuestCompletionClaims()).resolves.toBeUndefined();
    await expect(flushPendingGuestCompletionClaims()).resolves.toBeUndefined();

    expect(mockedDb.resolveGuestCompletionClaim).toHaveBeenCalledWith(
      claim.localSessionId,
      'rejected',
      409,
    );
    expect(mockedApi.completeProgress).toHaveBeenCalledTimes(1);
  });

  it('delivers later claims even when an earlier one still fails', async () => {
    const second = {
      ...claim,
      localSessionId: 'local-2',
      remoteSessionId: '00000000-0000-4000-8000-000000000003',
    };
    mockedDb.getPendingGuestCompletionClaims.mockResolvedValue([claim, second]);
    mockedApi.completeProgress
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce({ revision: 0, terminalCompleted: true });
    mockedDb.resolveGuestCompletionClaim.mockResolvedValue(undefined);

    await expect(flushPendingGuestCompletionClaims()).rejects.toThrow(
      'Network request failed',
    );

    expect(mockedApi.completeProgress).toHaveBeenCalledTimes(2);
    expect(mockedDb.resolveGuestCompletionClaim).toHaveBeenCalledWith(
      second.localSessionId,
      'accepted',
    );
  });

  it('refreshes the existing Coin balance surface after a granted reward', async () => {
    mockedDb.getPendingGuestCompletionClaims.mockResolvedValue([claim]);
    mockedApi.completeProgress.mockResolvedValue({
      revision: 0,
      terminalCompleted: true,
      firstCompletionReward: { amount: 60, balance: 85 },
    });
    mockedDb.resolveGuestCompletionClaim.mockResolvedValue(undefined);
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await flushPendingGuestCompletionClaims();

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['economy', 'balance'],
    });
    invalidateSpy.mockRestore();
  });
});
