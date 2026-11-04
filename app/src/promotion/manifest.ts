import * as Crypto from 'expo-crypto';
import type { PendingRewardEvidence, PromotionManifest } from '../api/promotionContract';
import {
  getLatestCheckpoint,
  getLocalPatternLikes,
  getPendingGuestCompletionClaims,
  getProgressOps,
  getSessions,
  openNamespace,
  type PendingGuestCompletionClaim,
  type StitchingSession,
} from '../local-db';
import type { DrainTargets } from './handoff';

/** One session's local progress version, as the manifest records it. */
export interface SessionProgressVersion {
  deviceSeq: number;
  opCount: number;
  checkpointRevision: number;
}

/** Everything the manifest is derived from, read from the Guest namespace. */
export interface GuestLocalSnapshot {
  sessions: StitchingSession[];
  claims: PendingGuestCompletionClaim[];
  likes: Record<string, boolean>;
  progressVersions: Record<string, SessionProgressVersion>;
}

export interface GuestCapture {
  manifest: PromotionManifest;
  manifestChecksum: string;
  drain: DrainTargets;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pending Coin Reward source key the backend validates for a Guest's first completion. */
export function firstCompletionSourceKey(guestId: string, patternId: string): string {
  return `first_completion:guest:${guestId}:${patternId}`;
}

/**
 * JSON with object keys sorted at every depth, so equal values always
 * serialize to the same bytes regardless of the order they were built in.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function sha256Hex(text: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
}

export function computeManifestChecksum(manifest: PromotionManifest): Promise<string> {
  return sha256Hex(canonicalJson(manifest));
}

function isServerSession(
  session: StitchingSession,
): session is StitchingSession & { remoteSessionId: string } {
  return (
    typeof session.remoteSessionId === 'string' &&
    UUID.test(session.remoteSessionId) &&
    UUID.test(session.patternId)
  );
}

/**
 * Builds the Guest Promotion Manifest and the drain list from the Guest's
 * local records. Only sessions the backend already knows (a remote id) can be
 * promoted, so those are the sessions the manifest and drain list cover.
 * Checksums are computed by the caller-supplied hasher so this stays pure.
 */
export async function buildGuestCapture(
  guestId: string,
  snapshot: GuestLocalSnapshot,
  hash: (text: string) => Promise<string> = sha256Hex,
): Promise<GuestCapture> {
  const sessions = snapshot.sessions.filter(isServerSession).sort((a, b) => a.remoteSessionId.localeCompare(b.remoteSessionId));

  const progress: PromotionManifest['progress'] = {};
  const completions: PromotionManifest['completions'] = {};
  const drainSessions = new Map<string, { guestSessionId: string; patternId: string }>();

  for (const session of sessions) {
    const version = snapshot.progressVersions[session.id] ?? { deviceSeq: 0, opCount: 0, checkpointRevision: 0 };
    progress[session.remoteSessionId] = {
      deviceSeq: version.deviceSeq,
      checksum: await hash(
        canonicalJson({
          remoteSessionId: session.remoteSessionId,
          patternId: session.patternId,
          status: session.status,
          completedAt: session.completedAt ?? null,
          updatedAt: session.updatedAt,
          ...version,
        }),
      ),
    };
    if (session.status === 'completed' && session.completedAt) {
      const earlier = completions[session.patternId];
      if (earlier === undefined || session.completedAt > earlier) {
        completions[session.patternId] = session.completedAt;
      }
    }
    drainSessions.set(session.remoteSessionId, {
      guestSessionId: session.remoteSessionId,
      patternId: session.patternId,
    });
  }

  const pendingRewards: Record<string, PendingRewardEvidence> = {};
  for (const claim of snapshot.claims) {
    const session = sessions.find((candidate) => candidate.id === claim.localSessionId);
    if (!session) continue;
    pendingRewards[firstCompletionSourceKey(guestId, session.patternId)] = {
      localSessionId: claim.localSessionId,
      remoteSessionId: claim.remoteSessionId,
      patternId: session.patternId,
      completedAt: session.completedAt ?? session.updatedAt,
      completedCells: claim.completedCells,
    };
  }

  const likes: Record<string, boolean> = {};
  for (const [patternId, liked] of Object.entries(snapshot.likes)) {
    if (liked) likes[patternId] = true;
  }

  const manifest: PromotionManifest = { progress, completions, pendingRewards, likes };
  return {
    manifest,
    manifestChecksum: await hash(canonicalJson(manifest)),
    drain: {
      likes: Object.keys(likes).filter((patternId) => UUID.test(patternId)).sort(),
      sessions: [...drainSessions.values()],
    },
  };
}

/** Reads the Guest's local records from the Guest namespace and builds the capture. */
export async function captureGuestRecords(guestId: string): Promise<GuestCapture> {
  // The snapshot must come from the Guest's own namespace, never whichever
  // namespace happens to be open when sign-in completes.
  await openNamespace(guestId);
  const [sessions, claims, likes] = await Promise.all([
    getSessions(),
    getPendingGuestCompletionClaims(),
    getLocalPatternLikes(),
  ]);
  const progressVersions: Record<string, SessionProgressVersion> = {};
  for (const session of sessions.filter(isServerSession)) {
    const [ops, checkpoint] = await Promise.all([getProgressOps(session.id), getLatestCheckpoint(session.id)]);
    progressVersions[session.id] = {
      deviceSeq: ops.reduce((high, op) => Math.max(high, op.deviceSeq), 0),
      opCount: ops.length,
      checkpointRevision: checkpoint?.revision ?? 0,
    };
  }
  return buildGuestCapture(guestId, { sessions, claims, likes, progressVersions });
}
