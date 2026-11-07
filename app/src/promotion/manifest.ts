import * as Crypto from 'expo-crypto';
import type { PackagedSession, PendingRewardEvidence, PromotionManifest } from '../api/promotionContract';
import {
  getLatestCheckpoint,
  getLocalPatternLikes,
  getPendingGuestCompletionClaims,
  getProgressOps,
  getSessions,
  openNamespace,
  readSessionPackedProgress,
  type PackedSessionProgress,
  type PendingGuestCompletionClaim,
  type StitchingSession,
} from '../local-db';
import type { DrainSessionTarget, DrainTargets } from './handoff';

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
  packedProgress: Record<string, PackedSessionProgress>;
}

export interface GuestCapture {
  manifest: PromotionManifest;
  manifestChecksum: string;
  drain: DrainTargets;
  sessions: PackagedSession[];
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

const NO_PROGRESS: PackedSessionProgress = { packedBitmapBase64: '', completedCount: 0 };

function packageSession(session: StitchingSession, packedBitmapBase64: string): PackagedSession {
  return {
    key: session.remoteSessionId ?? session.id,
    localSessionId: session.id,
    remoteSessionId: session.remoteSessionId ?? null,
    patternId: session.patternId,
    source: session.source,
    artifactChecksum: session.artifactChecksum,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt ?? null,
    replayOf: session.replayOf ?? null,
    title: session.title ?? null,
    previewUrl: session.previewUrl ?? null,
    thumbnailUrl: session.thumbnailUrl ?? null,
    patternWidth: session.patternWidth ?? null,
    patternHeight: session.patternHeight ?? null,
    packedBitmapBase64,
  };
}

/**
 * Builds the Guest Promotion Manifest, the Promotion Package's sessions and the
 * drain list from the Guest's local records. A session the backend does not know
 * has nothing to transfer until the player touched it, so it is only carried
 * once it has progress or is completed. Checksums are computed by the
 * caller-supplied hasher so this stays pure.
 */
export async function buildGuestCapture(
  guestId: string,
  snapshot: GuestLocalSnapshot,
  hash: (text: string) => Promise<string> = sha256Hex,
): Promise<GuestCapture> {
  const progressOf = (session: StitchingSession): PackedSessionProgress =>
    snapshot.packedProgress[session.id] ?? NO_PROGRESS;
  const sessions = snapshot.sessions
    .filter(
      (session) => isServerSession(session) || session.status === 'completed' || progressOf(session).completedCount > 0,
    )
    .map((session) => ({ session, packaged: packageSession(session, progressOf(session).packedBitmapBase64) }))
    .sort((a, b) => a.packaged.key.localeCompare(b.packaged.key));

  const progress: PromotionManifest['progress'] = {};
  const completions: PromotionManifest['completions'] = {};
  const drainSessions = new Map<string, DrainSessionTarget>();

  for (const { session, packaged } of sessions) {
    const version = snapshot.progressVersions[session.id] ?? { deviceSeq: 0, opCount: 0, checkpointRevision: 0 };
    progress[packaged.key] = {
      deviceSeq: version.deviceSeq,
      checksum: await hash(
        canonicalJson({
          key: packaged.key,
          patternId: session.patternId,
          status: session.status,
          completedAt: session.completedAt ?? null,
          updatedAt: session.updatedAt,
          packedBitmapBase64: packaged.packedBitmapBase64,
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
    drainSessions.set(packaged.key, {
      guestSessionId: packaged.key,
      patternId: session.patternId,
      serverKnown: isServerSession(session),
    });
  }

  const pendingRewards: Record<string, PendingRewardEvidence> = {};
  for (const claim of snapshot.claims) {
    const session = snapshot.sessions.find((candidate) => candidate.id === claim.localSessionId);
    if (!session || !isServerSession(session)) continue;
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
    sessions: sessions.map(({ packaged }) => packaged),
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
  const packedProgress: Record<string, PackedSessionProgress> = {};
  for (const session of sessions) {
    const [ops, checkpoint, packed] = await Promise.all([
      getProgressOps(session.id),
      getLatestCheckpoint(session.id),
      readSessionPackedProgress(session.id),
    ]);
    packedProgress[session.id] = packed;
    progressVersions[session.id] = {
      deviceSeq: ops.reduce((high, op) => Math.max(high, op.deviceSeq), 0),
      opCount: ops.length,
      checkpointRevision: checkpoint?.revision ?? 0,
    };
  }
  return buildGuestCapture(guestId, { sessions, claims, likes, progressVersions, packedProgress });
}
