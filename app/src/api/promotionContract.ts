/**
 * Promotion wire contract (#281): request and response types, the typed error,
 * and the parsers that turn untyped JSON into them. No network access lives here,
 * so the identity layer can read these types without importing the API client.
 */
export type PromotionMode = 'economy' | 'data-only';

/**
 * Device-held evidence for one Pending Coin Reward. The backend never trusts
 * these values (ADR-0026): it re-derives eligibility from the source key and
 * the Guest's own server-side records, so this only names the local records
 * the reward came from.
 */
export interface PendingRewardEvidence {
  localSessionId: string;
  remoteSessionId: string;
  patternId: string;
  completedAt: string;
  completedCells: number;
}

export interface PromotionManifest {
  progress: Record<string, { deviceSeq: number; checksum: string }>;
  completions: Record<string, string>;
  pendingRewards: Record<string, PendingRewardEvidence>;
  likes: Record<string, boolean>;
}

/**
 * One Guest local session as the Promotion Package carries it. The bitmap is the
 * session's whole folded progress: ops alone are incomplete once a checkpoint
 * compacted them. Local-only sessions never reach the backend's session tables,
 * so `patternId` may be a bundled or pending personal id.
 */
export interface PackagedSession {
  /** remoteSessionId ?? localSessionId; also the key in `manifest.progress`. */
  key: string;
  localSessionId: string;
  remoteSessionId: string | null;
  patternId: string;
  source: 'bundled' | 'catalog' | 'personal';
  artifactChecksum: string;
  status: 'preparing' | 'ready' | 'active' | 'completed';
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  replayOf: string | null;
  title: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  patternWidth: number | null;
  patternHeight: number | null;
  packedBitmapBase64: string;
}

export interface PromotionPreviewRequest {
  guestId: string;
  guestCredential: string;
  manifest: PromotionManifest;
  manifestChecksum: string;
}

export interface PromotionPreviewResponse {
  guestId: string;
  accountId: string;
  promotionMode: PromotionMode;
  manifestChecksum: string;
  guestLedgerBalance: number;
  guestUnlockCount: number;
  pendingAdAttemptCount: number;
  validatedPendingRewards: string[];
  rejectedPendingRewards: Record<string, string>;
  dispositions: {
    coinBalance: 'transfer' | 'discard';
    pendingRewards: 'validate' | 'discard';
    progress: 'transfer';
    completions: 'transfer';
    likes: 'transfer';
  };
  expiry: string;
  signature: string;
  paidCommerce: 'transfer' | 'none';
}

export interface PromotionLockResponse {
  lockToken: string;
  expiry: string;
}

export interface PromotionPackageRequest {
  guestId: string;
  lockToken: string;
  manifestChecksum: string;
  packageData: { manifest: PromotionManifest; sessions: PackagedSession[] };
  checksum: string;
}

export interface PromotionStageResponse {
  status: 'staged';
  expiry: string;
}

export interface PromotionCommitResponse {
  status: 'committed';
  promotionMode: PromotionMode;
  replayed: boolean;
}

export interface DrainSessionResult {
  status: 'transferred' | 'merged' | 'acknowledged';
  /** The surviving server session, null when none exists. */
  accountSessionId: string | null;
  /** Server revision after the drain applied. */
  revision: number;
  /** Authoritative folded cells of the surviving session. */
  packedBitmapBase64: string | null;
  terminalCompleted: boolean;
  /** Promotion-Locked: the client must not seed a local row. */
  isLocked: boolean;
  detail?: string;
  role?: 'replay';
}

export interface CommercePromotionStatus {
  handoffId: string;
  status: 'pending' | 'processing' | 'acknowledged' | 'failed';
  syncingPurchases: boolean;
  attemptCount: number;
  lastFailureReason: string | null;
}

/** Machine codes the backend promotion endpoints answer with (contract for #281). */
export const PROMOTION_ERROR_CODES = [
  'guest_consumed',
  'preview_expired',
  'preview_invalid',
  'promotion_lock_expired',
  'promotion_stale',
] as const;

export type PromotionErrorCode = (typeof PROMOTION_ERROR_CODES)[number];

export function isPromotionErrorCode(code: string | null): code is PromotionErrorCode {
  return code !== null && (PROMOTION_ERROR_CODES as readonly string[]).includes(code);
}

/** Code reported when a 2xx body does not match the contract. */
export const INVALID_RESPONSE_CODE = 'invalid_response';

/**
 * A failed promotion request. `code` is the backend's machine code (or
 * `invalid_response` for a malformed success body); the server's English
 * `message` is kept only as the Error message for diagnostics and is never
 * shown to players (ADR-0051). `reason` mirrors `code` so the shared server
 * error presentation can classify this error too.
 */
export class PromotionApiError extends Error {
  readonly reason: string | null;

  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'PromotionApiError';
    this.reason = code;
  }
}

type JsonRecord = Record<string, unknown>;

export function isPromotionJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function invalidPromotionResponse(status: number, what: string): PromotionApiError {
  return new PromotionApiError(status, INVALID_RESPONSE_CODE, `Malformed promotion response: ${what}`);
}

function field(record: JsonRecord, key: string, status: number): unknown {
  if (!(key in record)) throw invalidPromotionResponse(status, `missing ${key}`);
  return record[key];
}

function stringField(record: JsonRecord, key: string, status: number): string {
  const value = field(record, key, status);
  if (typeof value !== 'string') throw invalidPromotionResponse(status, `${key} is not a string`);
  return value;
}

function countField(record: JsonRecord, key: string, status: number): number {
  const value = field(record, key, status);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalidPromotionResponse(status, `${key} is not a non-negative integer`);
  }
  return value;
}

function booleanField(record: JsonRecord, key: string, status: number): boolean {
  const value = field(record, key, status);
  if (typeof value !== 'boolean') throw invalidPromotionResponse(status, `${key} is not a boolean`);
  return value;
}

function oneOf<T extends string>(
  record: JsonRecord,
  key: string,
  allowed: readonly T[],
  status: number,
): T {
  const value = field(record, key, status);
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw invalidPromotionResponse(status, `${key} is not a known value`);
  return match;
}

function recordField(record: JsonRecord, key: string, status: number): JsonRecord {
  const value = field(record, key, status);
  if (!isPromotionJsonRecord(value)) throw invalidPromotionResponse(status, `${key} is not an object`);
  return value;
}

function stringArrayField(record: JsonRecord, key: string, status: number): string[] {
  const value = field(record, key, status);
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw invalidPromotionResponse(status, `${key} is not a string list`);
  }
  return value;
}

const PROMOTION_MODES = ['economy', 'data-only'] as const;

/**
 * Validates a preview and returns it unchanged. The server signs the preview
 * it issued and the lock and commit calls send it back, so the client forwards
 * exactly what it received instead of rebuilding it from the fields it knows.
 */
export function parsePromotionPreview(body: unknown, status = 200): PromotionPreviewResponse {
  if (!isPromotionJsonRecord(body)) throw invalidPromotionResponse(status, 'preview is not an object');
  stringField(body, 'guestId', status);
  stringField(body, 'accountId', status);
  oneOf(body, 'promotionMode', PROMOTION_MODES, status);
  stringField(body, 'manifestChecksum', status);
  countField(body, 'guestLedgerBalance', status);
  countField(body, 'guestUnlockCount', status);
  countField(body, 'pendingAdAttemptCount', status);
  stringArrayField(body, 'validatedPendingRewards', status);
  const rejected = recordField(body, 'rejectedPendingRewards', status);
  if (!Object.values(rejected).every((reason) => typeof reason === 'string')) {
    throw invalidPromotionResponse(status, 'rejectedPendingRewards is not a reason map');
  }
  const dispositions = recordField(body, 'dispositions', status);
  oneOf(dispositions, 'coinBalance', ['transfer', 'discard'], status);
  oneOf(dispositions, 'pendingRewards', ['validate', 'discard'], status);
  oneOf(dispositions, 'progress', ['transfer'], status);
  oneOf(dispositions, 'completions', ['transfer'], status);
  oneOf(dispositions, 'likes', ['transfer'], status);
  stringField(body, 'expiry', status);
  stringField(body, 'signature', status);
  oneOf(body, 'paidCommerce', ['transfer', 'none'], status);
  return body as unknown as PromotionPreviewResponse;
}

export function parsePromotionLock(body: unknown, status = 200): PromotionLockResponse {
  if (!isPromotionJsonRecord(body)) throw invalidPromotionResponse(status, 'lock is not an object');
  return { lockToken: stringField(body, 'lockToken', status), expiry: stringField(body, 'expiry', status) };
}

export function parsePromotionStage(body: unknown, status = 200): PromotionStageResponse {
  if (!isPromotionJsonRecord(body)) throw invalidPromotionResponse(status, 'stage is not an object');
  oneOf(body, 'status', ['staged'], status);
  return { status: 'staged', expiry: stringField(body, 'expiry', status) };
}

export function parsePromotionCommit(body: unknown, status = 200): PromotionCommitResponse {
  if (!isPromotionJsonRecord(body)) throw invalidPromotionResponse(status, 'commit is not an object');
  oneOf(body, 'status', ['committed'], status);
  return {
    status: 'committed',
    promotionMode: oneOf(body, 'promotionMode', PROMOTION_MODES, status),
    replayed: booleanField(body, 'replayed', status),
  };
}

function nullableStringField(record: JsonRecord, key: string, status: number): string | null {
  const value = field(record, key, status);
  if (value !== null && typeof value !== 'string') throw invalidPromotionResponse(status, `${key} is not text`);
  return value;
}

export function parseDrainSessionResult(body: unknown, status = 200): DrainSessionResult {
  if (!isPromotionJsonRecord(body)) throw invalidPromotionResponse(status, 'drain result is not an object');
  return {
    status: oneOf(body, 'status', ['transferred', 'merged', 'acknowledged'], status),
    accountSessionId: nullableStringField(body, 'accountSessionId', status),
    revision: countField(body, 'revision', status),
    packedBitmapBase64: nullableStringField(body, 'packedBitmapBase64', status),
    terminalCompleted: booleanField(body, 'terminalCompleted', status),
    isLocked: booleanField(body, 'isLocked', status),
    ...(typeof body.detail === 'string' ? { detail: body.detail } : {}),
    ...(body.role === 'replay' ? { role: 'replay' as const } : {}),
  };
}

export function parseCommerceStatus(body: unknown, status = 200): CommercePromotionStatus {
  if (!isPromotionJsonRecord(body)) throw invalidPromotionResponse(status, 'commerce status is not an object');
  const failure = field(body, 'lastFailureReason', status);
  if (failure !== null && typeof failure !== 'string') throw invalidPromotionResponse(status, 'lastFailureReason is not text');
  return {
    handoffId: stringField(body, 'handoffId', status),
    status: oneOf(body, 'status', ['pending', 'processing', 'acknowledged', 'failed'], status),
    syncingPurchases: booleanField(body, 'syncingPurchases', status),
    attemptCount: countField(body, 'attemptCount', status),
    lastFailureReason: failure,
  };
}
