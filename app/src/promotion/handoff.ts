import type {
  PromotionManifest,
  PromotionMode,
  PromotionPreviewResponse,
} from '../api/promotionContract';

/**
 * Promotion Handoff (CONTEXT.md, ADR-0028): the durable device record that
 * carries one Guest Data Promotion across the identity switch and app restarts.
 *
 * It is a state machine. `reducePromotion` is the only place a phase changes,
 * it is pure, and every persisted write is the output of one transition. The
 * effect runner (promotionRunner.ts) only performs the network call a phase
 * calls for and feeds the outcome back in as an event.
 */

/** A Guest Session the backend knows and that must be drained under the account. */
export interface DrainSessionTarget {
  guestSessionId: string;
  patternId: string;
}

/** Local items the handoff must see acknowledged before it can be removed. */
export interface DrainTargets {
  likes: string[];
  sessions: DrainSessionTarget[];
}

export interface AckedItems {
  likes: string[];
  sessions: string[];
}

export interface HandoffBase {
  guestId: string;
  accountId: string;
  manifest: PromotionManifest;
  manifestChecksum: string;
  drain: DrainTargets;
}

/** Why the player is looking at a fresh preview they must confirm again. */
export type PreviewNotice = 'stale' | null;

/**
 * Lock and stage happen before the commit, so the player may still cancel.
 * Once `commit` is the step, the request may already have reached the backend.
 */
export type CommitStep =
  | { kind: 'lock' }
  | { kind: 'stage'; lockToken: string }
  | { kind: 'commit' };

export type PromotionHandoff =
  | (HandoffBase & { phase: 'captured' })
  | (HandoffBase & { phase: 'previewing'; notice: PreviewNotice })
  | (HandoffBase & {
      phase: 'disclosing';
      preview: PromotionPreviewResponse;
      notice: PreviewNotice;
    })
  | (HandoffBase & {
      phase: 'committing';
      preview: PromotionPreviewResponse;
      step: CommitStep;
    })
  | (HandoffBase & { phase: 'syncing'; promotionMode: PromotionMode; acked: AckedItems })
  | (HandoffBase & { phase: 'needsAttention'; promotionMode: PromotionMode; acked: AckedItems });

export type PromotionPhase = PromotionHandoff['phase'];

export type PromotionEvent =
  | { type: 'previewStarted' }
  | { type: 'previewLoaded'; preview: PromotionPreviewResponse }
  | { type: 'guestConsumed' }
  | { type: 'confirmed' }
  | { type: 'cancelled' }
  | { type: 'locked'; lockToken: string }
  | { type: 'staged' }
  | { type: 'committed'; promotionMode: PromotionMode }
  | { type: 'previewInvalidated'; notice: PreviewNotice }
  | { type: 'likeAcked'; patternId: string }
  | { type: 'sessionAcked'; guestSessionId: string }
  | { type: 'syncExhausted' }
  | { type: 'syncRetried' };

export function isManifestEmpty(manifest: PromotionManifest): boolean {
  return (
    Object.keys(manifest.progress).length === 0 &&
    Object.keys(manifest.completions).length === 0 &&
    Object.keys(manifest.pendingRewards).length === 0 &&
    Object.keys(manifest.likes).length === 0
  );
}

/**
 * A promotion with nothing to move: no Coin, no Pattern Unlock, no validated
 * Pending Coin Reward, no pending ad attempt, and no local sessions, history or
 * Likes. The player is not shown a screen for it.
 */
export function isPreviewEmpty(preview: PromotionPreviewResponse, manifest: PromotionManifest): boolean {
  return (
    preview.guestLedgerBalance === 0 &&
    preview.guestUnlockCount === 0 &&
    preview.validatedPendingRewards.length === 0 &&
    preview.pendingAdAttemptCount === 0 &&
    isManifestEmpty(manifest)
  );
}

export function pendingLikes(handoff: PromotionHandoff & { acked: AckedItems }): string[] {
  const done = new Set(handoff.acked.likes);
  return handoff.drain.likes.filter((patternId) => !done.has(patternId));
}

export function pendingSessions(handoff: PromotionHandoff & { acked: AckedItems }): DrainSessionTarget[] {
  const done = new Set(handoff.acked.sessions);
  return handoff.drain.sessions.filter((target) => !done.has(target.guestSessionId));
}

function hasNothingToDrain(handoff: PromotionHandoff & { acked: AckedItems }): boolean {
  return pendingLikes(handoff).length === 0 && pendingSessions(handoff).length === 0;
}

/** Cancel is a pre-commit option only; after the commit request the switch is irreversible. */
export function canCancel(handoff: PromotionHandoff): boolean {
  switch (handoff.phase) {
    case 'captured':
    case 'previewing':
    case 'disclosing':
      return true;
    case 'committing':
      return handoff.step.kind !== 'commit';
    case 'syncing':
    case 'needsAttention':
      return false;
  }
}

/** True from the moment the commit request may have left the device. */
export function isPostCommit(handoff: PromotionHandoff): boolean {
  return handoff.phase === 'syncing' || handoff.phase === 'needsAttention';
}

function blankAcked(): AckedItems {
  return { likes: [], sessions: [] };
}

function startSyncing(handoff: PromotionHandoff, promotionMode: PromotionMode): PromotionHandoff | null {
  const next = { ...base(handoff), phase: 'syncing' as const, promotionMode, acked: blankAcked() };
  return hasNothingToDrain(next) ? null : next;
}

function base(handoff: PromotionHandoff): HandoffBase {
  return {
    guestId: handoff.guestId,
    accountId: handoff.accountId,
    manifest: handoff.manifest,
    manifestChecksum: handoff.manifestChecksum,
    drain: handoff.drain,
  };
}

/**
 * The next handoff for an event, or null when the handoff is finished and must
 * be deleted. An event that does not apply to the current phase leaves the
 * handoff unchanged, so replaying one after a crash converges instead of failing.
 */
export function reducePromotion(handoff: PromotionHandoff, event: PromotionEvent): PromotionHandoff | null {
  switch (event.type) {
    case 'guestConsumed':
      return null;

    case 'previewStarted':
      return handoff.phase === 'captured' ? { ...base(handoff), phase: 'previewing', notice: null } : handoff;

    case 'previewLoaded': {
      if (handoff.phase !== 'previewing') return handoff;
      if (isPreviewEmpty(event.preview, handoff.manifest)) return null;
      return { ...base(handoff), phase: 'disclosing', preview: event.preview, notice: handoff.notice };
    }

    case 'confirmed':
      return handoff.phase === 'disclosing'
        ? { ...base(handoff), phase: 'committing', preview: handoff.preview, step: { kind: 'lock' } }
        : handoff;

    case 'cancelled':
      return canCancel(handoff) ? null : handoff;

    case 'locked':
      return handoff.phase === 'committing' && handoff.step.kind === 'lock'
        ? { ...handoff, step: { kind: 'stage', lockToken: event.lockToken } }
        : handoff;

    case 'staged':
      return handoff.phase === 'committing' && handoff.step.kind !== 'commit'
        ? { ...handoff, step: { kind: 'commit' } }
        : handoff;

    case 'committed':
      return handoff.phase === 'committing' ? startSyncing(handoff, event.promotionMode) : handoff;

    case 'previewInvalidated':
      return handoff.phase === 'committing'
        ? { ...base(handoff), phase: 'previewing', notice: event.notice }
        : handoff;

    case 'likeAcked': {
      if (handoff.phase !== 'syncing' && handoff.phase !== 'needsAttention') return handoff;
      if (handoff.acked.likes.includes(event.patternId)) return handoff;
      const next = { ...handoff, acked: { ...handoff.acked, likes: [...handoff.acked.likes, event.patternId] } };
      return hasNothingToDrain(next) ? null : next;
    }

    case 'sessionAcked': {
      if (handoff.phase !== 'syncing' && handoff.phase !== 'needsAttention') return handoff;
      if (handoff.acked.sessions.includes(event.guestSessionId)) return handoff;
      const next = {
        ...handoff,
        acked: { ...handoff.acked, sessions: [...handoff.acked.sessions, event.guestSessionId] },
      };
      return hasNothingToDrain(next) ? null : next;
    }

    case 'syncExhausted':
      return handoff.phase === 'syncing' ? { ...handoff, phase: 'needsAttention' } : handoff;

    case 'syncRetried':
      return handoff.phase === 'needsAttention' ? { ...handoff, phase: 'syncing' } : handoff;
  }
}

export type PromotionRequestStage = 'preview' | 'lock' | 'stage' | 'commit';

/**
 * Maps a backend machine code to the transition it calls for, or null when the
 * code has no domain meaning and the player must see an error with Retry.
 *
 * A consumed Guest during lock or stage may already be committed to this very
 * account, so those stages hand over to commit, which answers idempotently
 * (replayed) or definitively (guest_consumed for another account).
 */
export function eventForFailureCode(code: string | null, stage: PromotionRequestStage): PromotionEvent | null {
  switch (code) {
    case 'guest_consumed':
      return stage === 'lock' || stage === 'stage' ? { type: 'staged' } : { type: 'guestConsumed' };
    case 'promotion_lock_expired':
    case 'preview_expired':
      return stage === 'preview' ? null : { type: 'previewInvalidated', notice: null };
    case 'promotion_stale':
    case 'preview_invalid':
      return stage === 'preview' ? null : { type: 'previewInvalidated', notice: 'stale' };
    default:
      return null;
  }
}
