import * as FileSystem from 'expo-file-system/legacy';
import type { PackagedSession, PromotionPreviewResponse } from '../api/promotionContract';
import { parsePromotionPreview } from '../api/promotionContract';
import type { DrainTargets, PromotionHandoff } from './handoff';

/**
 * Where the Promotion Handoff lives. It has to outlive the identity switch and
 * an app kill, so it cannot sit in the Local Identity Namespace database (that
 * database is swapped by `adoptAccountSession` and a Guest's copy is never
 * opened under the account). SecureStore is also wrong: its values are meant
 * to stay under about 2 KB and the manifest grows with the player's sessions,
 * and iOS keeps Keychain items after the app is deleted while the handoff must
 * not outlive the sandbox it refers to. A file in the app's document directory
 * has neither limit and is erased with the app, like the installation marker.
 */
export interface HandoffStore {
  load(): Promise<PromotionHandoff | null>;
  save(handoff: PromotionHandoff): Promise<void>;
  clear(): Promise<void>;
}

export const HANDOFF_FILENAME = 'promotion-handoff.v1.json';
const PENDING_SUFFIX = '.next';
const FORMAT_VERSION = 1;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string');
}

/** Handoffs from #281 builds have no `serverKnown`: every target they hold came from the backend. */
function readDrainTargets(value: unknown): DrainTargets | null {
  if (!isRecord(value) || !isStringList(value.likes) || !Array.isArray(value.sessions)) return null;
  const sessions: DrainTargets['sessions'] = [];
  for (const item of value.sessions) {
    if (!isRecord(item) || typeof item.guestSessionId !== 'string' || typeof item.patternId !== 'string') return null;
    sessions.push({
      guestSessionId: item.guestSessionId,
      patternId: item.patternId,
      serverKnown: item.serverKnown !== false,
    });
  }
  return { likes: value.likes, sessions };
}

const PACKAGED_TEXT_FIELDS = [
  'key',
  'localSessionId',
  'patternId',
  'artifactChecksum',
  'createdAt',
  'updatedAt',
  'packedBitmapBase64',
] as const;
const PACKAGED_SOURCES: readonly unknown[] = ['bundled', 'catalog', 'personal'];
const PACKAGED_STATUSES: readonly unknown[] = ['preparing', 'ready', 'active', 'completed'];

function isPackagedSession(value: unknown): value is PackagedSession {
  return (
    isRecord(value) &&
    PACKAGED_TEXT_FIELDS.every((name) => typeof value[name] === 'string') &&
    PACKAGED_SOURCES.includes(value.source) &&
    PACKAGED_STATUSES.includes(value.status)
  );
}

/** Handoffs from #281 builds carry no packaged sessions; that is a valid empty list, a bad entry is not. */
function readPackagedSessions(value: unknown): PackagedSession[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every(isPackagedSession) ? value : null;
}

function isAcked(value: unknown): boolean {
  return isRecord(value) && isStringList(value.likes) && isStringList(value.sessions);
}

function isManifest(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.progress) &&
    isRecord(value.completions) &&
    isRecord(value.pendingRewards) &&
    isRecord(value.likes)
  );
}

function readPreview(value: unknown): PromotionPreviewResponse | null {
  try {
    return parsePromotionPreview(value);
  } catch {
    return null;
  }
}

function isMode(value: unknown): boolean {
  return value === 'economy' || value === 'data-only';
}

function isStep(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'lock' || value.kind === 'commit') return true;
  return value.kind === 'stage' && typeof value.lockToken === 'string';
}

/**
 * Turns persisted JSON into a handoff, or null when it is not one. The file is
 * a trust boundary like any other input: a truncated or foreign file must not
 * be handed to the reducer as if it were typed state.
 */
export function parseHandoff(raw: unknown): PromotionHandoff | null {
  if (!isRecord(raw) || raw.version !== FORMAT_VERSION || !isRecord(raw.handoff)) return null;
  const h = raw.handoff;
  const drain = readDrainTargets(h.drain);
  const sessions = readPackagedSessions(h.sessions);
  if (
    typeof h.guestId !== 'string' ||
    typeof h.accountId !== 'string' ||
    typeof h.manifestChecksum !== 'string' ||
    !isManifest(h.manifest) ||
    drain === null ||
    sessions === null
  ) {
    return null;
  }
  const common = {
    guestId: h.guestId,
    accountId: h.accountId,
    manifestChecksum: h.manifestChecksum,
    manifest: h.manifest as unknown as PromotionHandoff['manifest'],
    drain,
    sessions,
  };
  const notice = h.notice === 'stale' ? ('stale' as const) : null;

  switch (h.phase) {
    case 'captured':
      return { ...common, phase: 'captured' };
    case 'previewing':
      return { ...common, phase: 'previewing', notice };
    case 'disclosing': {
      const preview = readPreview(h.preview);
      return preview ? { ...common, phase: 'disclosing', preview, notice } : null;
    }
    case 'committing': {
      const preview = readPreview(h.preview);
      if (!preview || !isStep(h.step)) return null;
      return { ...common, phase: 'committing', preview, step: h.step as Extract<PromotionHandoff, { phase: 'committing' }>['step'] };
    }
    case 'syncing':
    case 'needsAttention':
      if (!isMode(h.promotionMode) || !isAcked(h.acked)) return null;
      return {
        ...common,
        phase: h.phase,
        promotionMode: h.promotionMode as 'economy' | 'data-only',
        acked: h.acked as { likes: string[]; sessions: string[] },
      };
    default:
      return null;
  }
}

function directory(): string | null {
  return FileSystem.documentDirectory;
}

async function exists(path: string): Promise<boolean> {
  return (await FileSystem.getInfoAsync(path)).exists;
}

/** A file that cannot be read or parsed is treated as no handoff, never as a crash. */
async function readHandoff(path: string): Promise<PromotionHandoff | null> {
  try {
    return parseHandoff(JSON.parse(await FileSystem.readAsStringAsync(path)) as unknown);
  } catch {
    return null;
  }
}

/**
 * File-backed store. A save writes the new content beside the live file and
 * then swaps it in, so a kill at any point leaves either the previous handoff
 * or the next one readable: while the live file exists it wins, and the pending
 * file is only trusted once the live file is gone, which happens after the
 * pending file was written completely.
 */
export function createFileHandoffStore(): HandoffStore {
  const paths = () => {
    const root = directory();
    return root === null ? null : { live: `${root}${HANDOFF_FILENAME}`, pending: `${root}${HANDOFF_FILENAME}${PENDING_SUFFIX}` };
  };

  return {
    async load() {
      const p = paths();
      if (p === null) return null;
      if (await exists(p.live)) return readHandoff(p.live);
      if (await exists(p.pending)) {
        const recovered = await readHandoff(p.pending);
        if (recovered) {
          await FileSystem.moveAsync({ from: p.pending, to: p.live });
        }
        return recovered;
      }
      return null;
    },

    async save(handoff) {
      const p = paths();
      // Web and mock environments have no sandbox; there is no Guest data to carry there.
      if (p === null) return;
      await FileSystem.writeAsStringAsync(p.pending, JSON.stringify({ version: FORMAT_VERSION, handoff }));
      await FileSystem.deleteAsync(p.live, { idempotent: true });
      await FileSystem.moveAsync({ from: p.pending, to: p.live });
    },

    async clear() {
      const p = paths();
      if (p === null) return;
      await FileSystem.deleteAsync(p.pending, { idempotent: true });
      await FileSystem.deleteAsync(p.live, { idempotent: true });
    },
  };
}

export const handoffStore: HandoffStore = createFileHandoffStore();
