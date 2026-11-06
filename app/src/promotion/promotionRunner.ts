import {
  PromotionApiError,
  type DrainSessionResult,
  type PackagedSession,
  type PromotionCommitResponse,
  type PromotionLockResponse,
  type PromotionPackageRequest,
  type PromotionPreviewRequest,
  type PromotionPreviewResponse,
  type PromotionStageResponse,
} from '../api/promotionContract';
import { classifyPromotionFailure, type PromotionFailure } from './failure';
import {
  canCancel,
  eventForFailureCode,
  isSyncHandoff,
  pendingLikes,
  pendingSessions,
  reducePromotion,
  type PromotionEvent,
  type PromotionHandoff,
  type PromotionRequestStage,
  type SyncHandoff,
  type DrainSessionTarget,
} from './handoff';
import type { HandoffStore } from './handoffStore';

/** The slice of the promotion API the runner drives. */
export interface PromotionApi {
  fetchPromotionPreview(dto: PromotionPreviewRequest): Promise<PromotionPreviewResponse>;
  lockPromotion(previewData: PromotionPreviewResponse, signature: string): Promise<PromotionLockResponse>;
  stagePromotionPackage(dto: PromotionPackageRequest): Promise<PromotionStageResponse>;
  commitPromotion(previewData: PromotionPreviewResponse, signature: string): Promise<PromotionCommitResponse>;
  cancelPromotion(guestId: string): Promise<void>;
  drainLike(guestId: string, patternId: string): Promise<void>;
  drainSession(guestId: string, patternId: string, guestSessionId: string): Promise<DrainSessionResult>;
}

export interface PromotionRunnerDeps {
  store: HandoffStore;
  api: PromotionApi;
  readCredentialSecret(): Promise<string | null>;
  /** Marks a drained Like on in the open (account) namespace. */
  markLikeInAccountNamespace(patternId: string): Promise<void>;
  /** Brings a session into the account namespace. `server` is null for a local-only session. */
  adoptSession(
    owners: { guestId: string; accountId: string },
    session: PackagedSession,
    server: DrainSessionResult | null,
  ): Promise<void>;
  /** Signs the target account out and restores the unchanged Guest session. */
  returnToGuest(): Promise<void>;
  /** The account's Coin, Unlocks or rewards may have changed on the backend. */
  onEconomyChanged(): void;
  wait(ms: number): Promise<void>;
  /** One entry per automatic retry round after the first sync attempt. */
  syncBackoffMs: readonly number[];
}

export interface PromotionFlowSnapshot {
  handoff: PromotionHandoff | null;
  failure: PromotionFailure | null;
}

export interface PromotionRunner {
  getSnapshot(): PromotionFlowSnapshot;
  subscribe(listener: () => void): () => void;
  /** Continues whatever handoff is stored for this account, from its persisted phase. */
  resume(accountId: string): Promise<void>;
  confirm(): Promise<void>;
  cancel(): Promise<void>;
  retry(): Promise<void>;
}

function stageOf(handoff: PromotionHandoff): PromotionRequestStage {
  if (handoff.phase === 'previewing') return 'preview';
  if (handoff.phase === 'committing') return handoff.step.kind;
  return 'commit';
}

export function createPromotionRunner(deps: PromotionRunnerDeps): PromotionRunner {
  let snapshot: PromotionFlowSnapshot = { handoff: null, failure: null };
  const listeners = new Set<() => void>();
  let driving: Promise<void> | null = null;
  let driveAgain = false;

  function publish(next: PromotionFlowSnapshot): void {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  /** Persists the next handoff before it becomes visible, so a kill never loses a step. */
  async function transition(event: PromotionEvent): Promise<void> {
    const current = snapshot.handoff;
    if (current === null) return;
    const next = reducePromotion(current, event);
    if (next === null) await deps.store.clear();
    else if (next !== current) await deps.store.save(next);
    publish({ handoff: next, failure: null });
  }

  async function requestPreview(handoff: Extract<PromotionHandoff, { phase: 'previewing' }>): Promise<void> {
    const guestCredential = await deps.readCredentialSecret();
    if (guestCredential === null) {
      throw new PromotionApiError(401, null, 'The Guest credential is not available on this device');
    }
    const preview = await deps.api.fetchPromotionPreview({
      guestId: handoff.guestId,
      guestCredential,
      manifest: handoff.manifest,
      manifestChecksum: handoff.manifestChecksum,
    });
    if (preview.manifestChecksum !== handoff.manifestChecksum || preview.accountId !== handoff.accountId) {
      throw new PromotionApiError(200, 'invalid_response', 'The preview does not belong to this handoff');
    }
    await transition({ type: 'previewLoaded', preview });
  }

  async function advanceCommit(handoff: Extract<PromotionHandoff, { phase: 'committing' }>): Promise<void> {
    const { preview, step } = handoff;
    switch (step.kind) {
      case 'lock': {
        const lock = await deps.api.lockPromotion(preview, preview.signature);
        await transition({ type: 'locked', lockToken: lock.lockToken });
        return;
      }
      case 'stage': {
        await deps.api.stagePromotionPackage({
          guestId: handoff.guestId,
          lockToken: step.lockToken,
          manifestChecksum: handoff.manifestChecksum,
          packageData: { manifest: handoff.manifest, sessions: handoff.sessions },
          checksum: handoff.manifestChecksum,
        });
        await transition({ type: 'staged' });
        return;
      }
      case 'commit': {
        // The server answers a repeated commit with replayed:true, so resuming
        // here after a kill can never apply the promotion twice.
        const result = await deps.api.commitPromotion(preview, preview.signature);
        await transition({ type: 'committed', promotionMode: result.promotionMode });
        deps.onEconomyChanged();
        return;
      }
    }
  }

  /**
   * Moves one session to the account. Both steps are idempotent, so a kill or a
   * failed adoption simply repeats them before the ack is recorded. A handoff
   * from a #281 build has no packaged record, so it only drains.
   */
  async function transferSession(handoff: SyncHandoff, target: DrainSessionTarget): Promise<void> {
    const packaged = handoff.sessions.find((session) => session.key === target.guestSessionId);
    const server = target.serverKnown
      ? await deps.api.drainSession(handoff.guestId, target.patternId, target.guestSessionId)
      : null;
    if (packaged === undefined || server?.isLocked === true) return;
    await deps.adoptSession({ guestId: handoff.guestId, accountId: handoff.accountId }, packaged, server);
  }

  /** Drains every unacknowledged item once; returns how many failed. */
  async function drainRound(): Promise<number> {
    let failures = 0;
    const start = snapshot.handoff;
    if (start === null || !isSyncHandoff(start)) return 0;
    for (const patternId of pendingLikes(start)) {
      try {
        await deps.api.drainLike(start.guestId, patternId);
        await deps.markLikeInAccountNamespace(patternId);
        await transition({ type: 'likeAcked', patternId });
      } catch {
        failures += 1;
      }
    }
    const afterLikes = snapshot.handoff;
    if (afterLikes === null || !isSyncHandoff(afterLikes)) return failures;
    for (const target of pendingSessions(afterLikes)) {
      try {
        await transferSession(afterLikes, target);
        await transition({ type: 'sessionAcked', guestSessionId: target.guestSessionId });
      } catch {
        failures += 1;
      }
    }
    return failures;
  }

  async function syncUntilDoneOrExhausted(): Promise<void> {
    for (let round = 0; ; round += 1) {
      const failures = await drainRound();
      if (snapshot.handoff === null) {
        deps.onEconomyChanged();
        return;
      }
      if (failures === 0) {
        // Everything is acknowledged but the handoff survived, so it was
        // persisted in a state the reducer would have finished.
        await deps.store.clear();
        publish({ handoff: null, failure: null });
        deps.onEconomyChanged();
        return;
      }
      const delay = deps.syncBackoffMs[round];
      if (delay === undefined) {
        await transition({ type: 'syncExhausted' });
        return;
      }
      await deps.wait(delay);
    }
  }

  /** Runs the effect the current phase calls for. Returns false when the flow must wait for the player. */
  async function step(handoff: PromotionHandoff): Promise<boolean> {
    try {
      switch (handoff.phase) {
        case 'captured':
          await transition({ type: 'previewStarted' });
          return true;
        case 'previewing':
          await requestPreview(handoff);
          return true;
        case 'committing':
          await advanceCommit(handoff);
          return true;
        case 'syncing':
          await syncUntilDoneOrExhausted();
          return false;
        case 'disclosing':
        case 'needsAttention':
          return false;
      }
    } catch (error) {
      const event =
        error instanceof PromotionApiError ? eventForFailureCode(error.code, stageOf(handoff)) : null;
      if (event !== null) {
        try {
          await transition(event);
          return true;
        } catch (transitionError) {
          publish({ handoff: snapshot.handoff, failure: classifyPromotionFailure(transitionError) });
          return false;
        }
      }
      publish({ handoff: snapshot.handoff, failure: classifyPromotionFailure(error) });
      return false;
    }
  }

  async function loop(): Promise<void> {
    for (;;) {
      const handoff = snapshot.handoff;
      if (handoff === null || snapshot.failure !== null) return;
      if (!(await step(handoff))) return;
    }
  }

  function drive(): Promise<void> {
    if (driving !== null) {
      driveAgain = true;
      return driving;
    }
    driving = (async () => {
      do {
        driveAgain = false;
        await loop();
      } while (driveAgain);
    })().finally(() => {
      driving = null;
    });
    return driving;
  }

  async function guarded(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      publish({ handoff: snapshot.handoff, failure: classifyPromotionFailure(error) });
    }
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async resume(accountId) {
      let stored = snapshot.handoff;
      if (stored === null) {
        try {
          stored = await deps.store.load();
        } catch (error) {
          publish({ handoff: null, failure: classifyPromotionFailure(error) });
          return;
        }
      }
      if (stored === null) return;
      if (stored.accountId !== accountId) {
        // A pre-commit handoff for another account can never be confirmed
        // here; a post-commit one still owns items and waits for its account.
        if (!isSyncHandoff(stored)) {
          await guarded(async () => {
            await deps.store.clear();
            publish({ handoff: null, failure: null });
          });
        }
        return;
      }
      if (snapshot.handoff === null) publish({ handoff: stored, failure: null });
      await drive();
    },

    async confirm() {
      if (snapshot.handoff?.phase !== 'disclosing') return;
      await guarded(() => transition({ type: 'confirmed' }));
      await drive();
    },

    async cancel() {
      const handoff = snapshot.handoff;
      if (handoff === null || !canCancel(handoff)) return;
      await guarded(async () => {
        if (handoff.phase === 'committing') {
          // A lock may be held. If releasing it fails the lease expires on its own.
          await deps.api.cancelPromotion(handoff.guestId).catch(() => undefined);
        }
        await deps.returnToGuest();
        await transition({ type: 'cancelled' });
      });
    },

    async retry() {
      const handoff = snapshot.handoff;
      if (handoff === null) return;
      publish({ handoff, failure: null });
      if (handoff.phase === 'needsAttention') {
        await guarded(() => transition({ type: 'syncRetried' }));
      }
      await drive();
    },
  };
}
