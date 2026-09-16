import { completeProgress, ProgressSyncError } from '../api/progressSync';
import { coinBalanceQueryKey } from '../api/economy';
import {
  completeGuestSessionWithPendingClaim,
  getPendingGuestCompletionClaims,
  GameplayEvent,
  PendingGuestCompletionClaim,
  resolveGuestCompletionClaim,
} from '../local-db';
import { queryClient } from '../providers';

const NON_RETRYABLE_STATUSES = new Set([404, 409, 410]);

export async function queueGuestCompletionClaim(
  claim: PendingGuestCompletionClaim,
  completedAt: string,
  gameplayEvents: GameplayEvent[],
  gameplaySeq: number,
): Promise<void> {
  await completeGuestSessionWithPendingClaim(
    claim,
    completedAt,
    gameplayEvents,
    gameplaySeq,
  );
}

export async function flushPendingGuestCompletionClaims(): Promise<void> {
  const claims = await getPendingGuestCompletionClaims();
  // One claim the server cannot take yet must not hold back the others, so
  // retryable failures are collected and rethrown after the whole queue ran.
  const retryableErrors: unknown[] = [];
  for (const claim of claims) {
    try {
      const result = await completeProgress(
        claim.remoteSessionId,
        claim.deviceId,
        claim.completedCells,
      );
      if (!result.terminalCompleted) {
        throw new Error('Guest completion claim did not reach terminal state');
      }
      await resolveGuestCompletionClaim(claim.localSessionId, 'accepted');
      if (result.firstCompletionReward) {
        queryClient.invalidateQueries({ queryKey: coinBalanceQueryKey });
      }
    } catch (error) {
      if (
        error instanceof ProgressSyncError &&
        NON_RETRYABLE_STATUSES.has(error.status)
      ) {
        await resolveGuestCompletionClaim(
          claim.localSessionId,
          'rejected',
          error.status,
        );
        continue;
      }
      retryableErrors.push(error);
    }
  }
  const firstError = retryableErrors[0];
  if (firstError !== undefined) {
    throw firstError instanceof Error
      ? firstError
      : new Error('Guest completion claim flush failed');
  }
}
