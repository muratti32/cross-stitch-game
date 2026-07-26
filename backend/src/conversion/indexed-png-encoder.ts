import * as zlib from 'node:zlib';

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

function crc32(type: Buffer, data: Buffer): number {
  let crc = -1;
  for (let i = 0; i < type.length; i++) {
    crc = crcTable[(crc ^ type[i]) & 0xFF] ^ (crc >>> 8);
  }
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function makeChunk(typeStr: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(typeStr, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crc = crc32(typeBuf, data);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function encodeIndexedPng(input: {
  width: number;
  height: number;
  data: Uint8Array;
}): Buffer | null {
  const { width, height, data } = input;

  if (width <= 0 || height <= 0) {
    return null;
  }
  if (data.length !== width * height * 4) {
    return null;
  }

  const colorMap = new Map<number, number>();
  const palette: number[] = [];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a !== 255) {
      return null;
    }

    const rgb = (r << 16) | (g << 8) | b;
    if (!colorMap.has(rgb)) {
      if (palette.length >= 256) {
        return null;
      }
      colorMap.set(rgb, palette.length);
      palette.push(rgb);
    }
  }

  const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 3;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = makeChunk('IHDR', ihdrData);

  const plteData = Buffer.alloc(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    const rgb = palette[i];
    plteData[i * 3] = (rgb >> 16) & 0xFF;
    plteData[i * 3 + 1] = (rgb >> 8) & 0xFF;
    plteData[i * 3 + 2] = rgb & 0xFF;
  }
  const plte = makeChunk('PLTE', plteData);

  const raw = Buffer.alloc(height * (1 + width));
  let rawOffset = 0;
  let dataOffset = 0;
  for (let y = 0; y < height; y++) {
    raw[rawOffset++] = 0;
    for (let x = 0; x < width; x++) {
      const r = data[dataOffset++];
      const g = data[dataOffset++];
      const b = data[dataOffset++];
      const a = data[dataOffset++];

      if (a !== 255) {
        return null;
      }

      const rgb = (r << 16) | (g << 8) | b;
      const index = colorMap.get(rgb);
      if (index === undefined) {
        return null;
      }
      raw[rawOffset++] = index;
    }
  }

  const deflated = zlib.deflateSync(raw, { level: 9 });
  const idat = makeChunk('IDAT', deflated);

  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([pngSignature, ihdr, plte, idat, iend]);
}
