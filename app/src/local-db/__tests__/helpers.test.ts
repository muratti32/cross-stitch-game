import {
  base64ToUint8Array,
  foldPackedProgress,
  packCompletedBitmap,
  uint8ArrayToBase64,
  unionPackedBitmaps,
} from '../helpers';

const bytes = (progress: { packedBitmapBase64: string }): number[] =>
  Array.from(base64ToUint8Array(progress.packedBitmapBase64));

describe('packCompletedBitmap', () => {
  test('writes cell i to bit i % 8 of byte i >> 3, least significant bit first, as the backend checkpoint does', () => {
    const completed = new Uint8Array(12);
    completed[0] = 1;
    completed[3] = 1;
    completed[9] = 1;

    expect(Array.from(packCompletedBitmap(completed))).toEqual([0b0000_1001, 0b0000_0010]);
  });
});

describe('foldPackedProgress', () => {
  test('replays ops over the checkpoint', () => {
    const progress = foldPackedProgress(new Uint8Array([0b0000_0011]), [
      { cellIndex: 1, desiredState: 'incomplete' },
      { cellIndex: 2, desiredState: 'completed' },
    ]);

    expect(bytes(progress)).toEqual([0b0000_0101]);
    expect(progress.completedCount).toBe(2);
  });

  test('sizes the record from the highest op when there is no checkpoint', () => {
    const progress = foldPackedProgress(new Uint8Array(0), [{ cellIndex: 9, desiredState: 'completed' }]);

    expect(bytes(progress)).toEqual([0, 0b0000_0010]);
    expect(progress.completedCount).toBe(1);
  });

  test('later ops on one cell win', () => {
    const progress = foldPackedProgress(new Uint8Array(0), [
      { cellIndex: 2, desiredState: 'completed' },
      { cellIndex: 2, desiredState: 'incomplete' },
    ]);

    expect(progress.completedCount).toBe(0);
  });

  test('no checkpoint and no ops is an empty record', () => {
    expect(foldPackedProgress(new Uint8Array(0), [])).toEqual({ packedBitmapBase64: '', completedCount: 0 });
  });
});

describe('unionPackedBitmaps', () => {
  test('keeps every completed bit of both records, whichever is longer', () => {
    expect(Array.from(unionPackedBitmaps(new Uint8Array([0b01]), new Uint8Array([0b10, 0b1])))).toEqual([0b11, 0b1]);
  });
});

describe('base64 round trip', () => {
  test.each([[[1]], [[1, 2]], [[1, 2, 3]], [[255, 0, 128, 7]]])('preserves %j', (input) => {
    expect(Array.from(base64ToUint8Array(uint8ArrayToBase64(new Uint8Array(input))))).toEqual(input);
  });
});
