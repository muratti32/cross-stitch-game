import { PNG } from 'pngjs';
import { encodeIndexedPng } from './indexed-png-encoder';

describe('Indexed PNG Encoder', () => {
  it('should round-trip a 4x4 image with three colours successfully', () => {
    const width = 4;
    const height = 4;
    const data = new Uint8Array(width * height * 4);
    const colors: number[][] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255]
    ];

    for (let i = 0; i < width * height; i++) {
      const color = colors[i % colors.length];
      data[i * 4] = color[0];
      data[i * 4 + 1] = color[1];
      data[i * 4 + 2] = color[2];
      data[i * 4 + 3] = 255;
    }

    const encoded = encodeIndexedPng({ width, height, data });
    expect(encoded).not.toBeNull();

    const result = PNG.sync.read(encoded!);
    expect(result.width).toBe(width);
    expect(result.height).toBe(height);
    for (let i = 0; i < data.length; i++) {
      expect(result.data[i]).toBe(data[i]);
    }
  });

  it('should round-trip a 1x1 image', () => {
    const width = 1;
    const height = 1;
    const data = new Uint8Array([120, 150, 180, 255]);

    const encoded = encodeIndexedPng({ width, height, data });
    expect(encoded).not.toBeNull();

    const result = PNG.sync.read(encoded!);
    expect(result.width).toBe(width);
    expect(result.height).toBe(height);
    expect(result.data[0]).toBe(120);
    expect(result.data[1]).toBe(150);
    expect(result.data[2]).toBe(180);
    expect(result.data[3]).toBe(255);
  });

  it('should output byte-identical buffers across repeat calls on the same input', () => {
    const width = 2;
    const height = 2;
    const data = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255
    ]);

    const res1 = encodeIndexedPng({ width, height, data });
    const res2 = encodeIndexedPng({ width, height, data });
    expect(res1).not.toBeNull();
    expect(res2).not.toBeNull();
    expect(res1!.equals(res2!)).toBe(true);
  });

  it('should be at least 2x smaller than PNG.sync.write for a 256x256 image with a handful of colours', () => {
    const width = 256;
    const height = 256;
    const data = new Uint8Array(width * height * 4);
    const colors: number[][] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [0, 255, 255]
    ];

    for (let i = 0; i < width * height; i++) {
      const color = colors[i % colors.length];
      data[i * 4] = color[0];
      data[i * 4 + 1] = color[1];
      data[i * 4 + 2] = color[2];
      data[i * 4 + 3] = 255;
    }

    const indexedPng = encodeIndexedPng({ width, height, data });
    expect(indexedPng).not.toBeNull();

    const pngjsObj = new PNG({ width, height });
    for (let i = 0; i < data.length; i++) {
      pngjsObj.data[i] = data[i];
    }
    const truecolorPng = PNG.sync.write(pngjsObj);

    expect(truecolorPng.length).toBeGreaterThan(indexedPng!.length * 2);
  });

  it('should return null if there are 257 distinct colours', () => {
    const width = 16;
    const height = 17;
    const data = new Uint8Array(width * height * 4);

    for (let i = 0; i < 257; i++) {
      data[i * 4] = i & 0xFF;
      data[i * 4 + 1] = (i >> 8) & 0xFF;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255;
    }
    for (let i = 257; i < width * height; i++) {
      data[i * 4] = 0;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255;
    }

    const encoded = encodeIndexedPng({ width, height, data });
    expect(encoded).toBeNull();
  });

  it('should encode successfully and round-trip when there are exactly 256 distinct colours', () => {
    const width = 16;
    const height = 16;
    const data = new Uint8Array(width * height * 4);

    for (let i = 0; i < 256; i++) {
      data[i * 4] = i;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255;
    }

    const encoded = encodeIndexedPng({ width, height, data });
    expect(encoded).not.toBeNull();

    const result = PNG.sync.read(encoded!);
    expect(result.width).toBe(width);
    expect(result.height).toBe(height);
    for (let i = 0; i < data.length; i++) {
      expect(result.data[i]).toBe(data[i]);
    }
  });

  it('should return null if any pixel has alpha less than 255', () => {
    const width = 2;
    const height = 2;
    const data = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 254, 255, 255, 255, 255
    ]);

    const encoded = encodeIndexedPng({ width, height, data });
    expect(encoded).toBeNull();
  });

  it('should return null if data length does not match width * height * 4', () => {
    const width = 2;
    const height = 2;
    const data = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255
    ]);

    const encoded = encodeIndexedPng({ width, height, data });
    expect(encoded).toBeNull();
  });

  it('should return null on a non-positive dimension', () => {
    const data = new Uint8Array(0);
    expect(encodeIndexedPng({ width: 0, height: 10, data })).toBeNull();
    expect(encodeIndexedPng({ width: 10, height: -1, data })).toBeNull();
  });
});
