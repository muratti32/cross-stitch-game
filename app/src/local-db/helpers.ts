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
