/**
 * Packs completed grid (0 or 1 per cell) into a 1-bit-per-cell bitmap.
 */
export function packCompletedBitmap(completed: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(completed.length / 8));
  for (let i = 0; i < completed.length; i++) {
    if (completed[i] === 1) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = i % 8;
      bytes[byteIdx] |= (1 << bitIdx);
    }
  }
  return bytes;
}

/**
 * Unpacks a 1-bit-per-cell bitmap into a completed grid (0 or 1 per cell).
 */
export function unpackCompletedBitmap(bitmap: Uint8Array, length: number): Uint8Array {
  const completed = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = i % 8;
    if (byteIdx < bitmap.length) {
      completed[i] = (bitmap[byteIdx] & (1 << bitIdx)) !== 0 ? 1 : 0;
    }
  }
  return completed;
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  let bufferLength = Math.floor(len * 0.75);
  if (clean[len - 1] === '=') bufferLength--;
  if (clean[len - 2] === '=') bufferLength--;

  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const encoded1 = lookup[clean.charCodeAt(i)] ?? 0;
    const encoded2 = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const encoded3 = lookup[clean.charCodeAt(i + 2)] ?? 0;
    const encoded4 = lookup[clean.charCodeAt(i + 3)] ?? 0;

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (p < bufferLength) {
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }
    if (p < bufferLength) {
      bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    result += chars[bytes[i] >> 2];
    result += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    result += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
    result += chars[bytes[i + 2] & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    result += chars[bytes[i] >> 2];
    result += chars[(bytes[i] & 3) << 4];
    result += '==';
  } else if (remaining === 2) {
    result += chars[bytes[i] >> 2];
    result += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    result += chars[(bytes[i + 1] & 15) << 2];
    result += '=';
  }
  return result;
}

export interface PackedSessionProgress {
  packedBitmapBase64: string;
  completedCount: number;
}

/**
 * Folds a checkpoint bitmap and the ops newer than it into a complete packed
 * record. Needs no pattern dimensions: the highest cell either source mentions
 * sets the length, and bits past the real grid are ignored by every reader.
 */
export function foldPackedProgress(
  checkpointBitmap: Uint8Array,
  ops: readonly { cellIndex: number; desiredState: 'completed' | 'incomplete' }[],
): PackedSessionProgress {
  const highestOpCell = ops.reduce((high, op) => Math.max(high, op.cellIndex), -1);
  const completed = unpackCompletedBitmap(
    checkpointBitmap,
    Math.max(checkpointBitmap.length * 8, highestOpCell + 1),
  );
  for (const op of ops) {
    if (op.cellIndex >= 0) completed[op.cellIndex] = op.desiredState === 'completed' ? 1 : 0;
  }
  return {
    packedBitmapBase64: uint8ArrayToBase64(packCompletedBitmap(completed)),
    completedCount: completed.reduce((count, cell) => count + cell, 0),
  };
}

export function unionPackedBitmaps(a: Uint8Array, b: Uint8Array): Uint8Array {
  const union = new Uint8Array(Math.max(a.length, b.length));
  for (let i = 0; i < union.length; i++) {
    union[i] = (a[i] ?? 0) | (b[i] ?? 0);
  }
  return union;
}

/**
 * Generates a standard UUID v4.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
