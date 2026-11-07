/** The part of an app-packaged session (app/src/api/promotionContract.ts) the backend reads. */
export interface PackagedSession {
  key: string;
  status: PackagedSessionStatus;
  completedAt: string | null;
  packedBitmapBase64: string;
}

const PACKAGED_SESSION_STATUSES = ['preparing', 'ready', 'active', 'completed'] as const;
type PackagedSessionStatus = (typeof PACKAGED_SESSION_STATUSES)[number];

const MAX_PACKED_BITMAP_BYTES = 1024 * 1024;
const MAX_PACKED_BITMAP_BASE64_LENGTH = Math.ceil(MAX_PACKED_BITMAP_BYTES / 3) * 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBase64(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function isPackagedSessionStatus(value: unknown): value is PackagedSessionStatus {
  return PACKAGED_SESSION_STATUSES.some((status) => status === value);
}

function parsePackagedSession(value: unknown): PackagedSession | null {
  if (!isRecord(value)) return null;
  const { key, status, completedAt, packedBitmapBase64 } = value;
  if (typeof key !== 'string' || key.length === 0) return null;
  if (!isPackagedSessionStatus(status)) return null;
  if (typeof packedBitmapBase64 !== 'string') return null;
  if (packedBitmapBase64.length > MAX_PACKED_BITMAP_BASE64_LENGTH || !isBase64(packedBitmapBase64)) return null;
  const completedAtIsValid =
    completedAt === null || (typeof completedAt === 'string' && !Number.isNaN(Date.parse(completedAt)));
  if (!completedAtIsValid) return null;
  return { key, status, completedAt, packedBitmapBase64 };
}

/**
 * Reads `packageData.sessions`. A package without the field comes from a client
 * older than #288 and parses to an empty list; a malformed one parses to null.
 */
export function parsePackagedSessions(packageData: object): readonly PackagedSession[] | null {
  const sessions = (packageData as { sessions?: unknown }).sessions;
  if (sessions === undefined) return [];
  if (!Array.isArray(sessions)) return null;
  const parsed: PackagedSession[] = [];
  for (const session of sessions) {
    const packaged = parsePackagedSession(session);
    if (packaged === null) return null;
    parsed.push(packaged);
  }
  return parsed;
}

/** Completed cell indices of an LSB-first packed bitmap, ignoring bits at or beyond `totalCells`. */
export function unpackCompletedCells(packedBitmap: Buffer, totalCells: number): number[] {
  const cells: number[] = [];
  const bitLength = Math.min(packedBitmap.length * 8, totalCells);
  for (let cell = 0; cell < bitLength; cell += 1) {
    if ((packedBitmap[cell >> 3] & (1 << (cell % 8))) !== 0) cells.push(cell);
  }
  return cells;
}

export function packCompletedCells(cells: readonly number[], totalCells: number): Buffer {
  const packedBitmap = Buffer.alloc(Math.ceil(totalCells / 8));
  for (const cell of cells) {
    if (cell < totalCells) packedBitmap[cell >> 3] |= 1 << (cell % 8);
  }
  return packedBitmap;
}
