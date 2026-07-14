import {
  decodePatternArtifactV1,
  encodePatternArtifactV1,
} from './pattern-artifact-encoder';

describe('Pattern Artifact v1 encoder', () => {
  const palette = [
    { dmcCode: '321', name: 'Christmas Red', rgbHex: '#C51E3A' },
    { dmcCode: '699', name: 'Green', rgbHex: '#056517' },
  ];

  function sampleGrid(): Uint8Array {
    const grid = new Uint8Array(4 * 4);
    grid[0] = 1;
    grid[5] = 2;
    grid[15] = 1;
    return grid;
  }

  it('round-trips dimensions, palette, and grid', () => {
    const encoded = encodePatternArtifactV1({
      width: 4,
      height: 4,
      palette,
      grid: sampleGrid(),
    });
    const decoded = decodePatternArtifactV1(encoded.bytes);

    expect(decoded.schemaVersion).toBe(1);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    expect(decoded.palette).toEqual(palette);
    expect(Array.from(decoded.grid)).toEqual(Array.from(sampleGrid()));
  });

  it('produces byte-identical output and checksum for identical input', () => {
    const a = encodePatternArtifactV1({
      width: 4,
      height: 4,
      palette,
      grid: sampleGrid(),
    });
    const b = encodePatternArtifactV1({
      width: 4,
      height: 4,
      palette,
      grid: sampleGrid(),
    });
    expect(a.checksum).toBe(b.checksum);
    expect(Buffer.compare(a.bytes, b.bytes)).toBe(0);
    expect(a.byteLength).toBe(a.bytes.length);
  });

  it('rejects grids that do not match the dimensions', () => {
    expect(() =>
      encodePatternArtifactV1({
        width: 4,
        height: 4,
        palette,
        grid: new Uint8Array(15),
      }),
    ).toThrow(RangeError);
  });

  it('rejects out-of-range dimensions and palette indices', () => {
    expect(() =>
      encodePatternArtifactV1({
        width: 301,
        height: 4,
        palette,
        grid: new Uint8Array(301 * 4),
      }),
    ).toThrow(RangeError);

    const badGrid = sampleGrid();
    badGrid[3] = 3;
    expect(() =>
      encodePatternArtifactV1({ width: 4, height: 4, palette, grid: badGrid }),
    ).toThrow(RangeError);
  });
});
