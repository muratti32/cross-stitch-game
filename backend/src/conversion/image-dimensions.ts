export interface ImageDimensions {
  contentType: 'image/jpeg' | 'image/png';
  height: number;
  width: number;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
  0xcf,
]);

export function readImageDimensions(bytes: Buffer): ImageDimensions {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return checked(width, height, 'image/png');
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) {
        offset += 1;
      }
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9) {
        continue;
      }
      if (offset + 2 > bytes.length) {
        break;
      }
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) {
        break;
      }
      if (JPEG_SOF_MARKERS.has(marker) && segmentLength >= 7) {
        return checked(
          bytes.readUInt16BE(offset + 5),
          bytes.readUInt16BE(offset + 3),
          'image/jpeg',
        );
      }
      offset += segmentLength;
    }
  }

  throw new RangeError('Artwork must be a valid single-frame JPEG or PNG');
}

function checked(
  width: number,
  height: number,
  contentType: ImageDimensions['contentType'],
): ImageDimensions {
  if (width < 1 || height < 1 || width > 12_000 || height > 12_000) {
    throw new RangeError('Artwork dimensions are outside the supported range');
  }
  return { contentType, height, width };
}
