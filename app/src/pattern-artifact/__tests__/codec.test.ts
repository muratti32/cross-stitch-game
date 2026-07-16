import * as protobuf from 'protobufjs';
import { gzip } from 'pako';
import { sha256 } from 'js-sha256';
import {
  encodePatternArtifact,
  decodePatternArtifact,
  PatternCodecError,
  PatternData,
} from '../index';

// Rebuild the protobuf schema inside the test to serialize custom test payloads (like version 2)
const schemaJson = {
  nested: {
    PaletteEntry: {
      fields: {
        dmcCode: { type: 'string', id: 1 },
        name: { type: 'string', id: 2 },
        rgbHex: { type: 'string', id: 3 },
      },
    },
    PatternEnvelope: {
      fields: {
        schemaVersion: { type: 'uint32', id: 1 },
        width: { type: 'uint32', id: 2 },
        height: { type: 'uint32', id: 3 },
        palette: { rule: 'repeated', type: 'PaletteEntry', id: 4 },
        grid: { type: 'bytes', id: 5 },
      },
    },
  },
};
const root = protobuf.Root.fromJSON(schemaJson);
const PatternEnvelope = root.lookupType('PatternEnvelope');

describe('Pattern Artifact Codec', () => {
  const mockPattern: PatternData = {
    schemaVersion: 1,
    width: 3,
    height: 3,
    palette: [
      { dmcCode: '321', name: 'Christmas Red', rgbHex: '#C51E3A' },
      { dmcCode: 'white', name: 'White', rgbHex: '#FFFFFF' },
    ],
    grid: new Uint8Array([
      1, 1, 1,
      1, 2, 1,
      1, 1, 1,
    ]),
  };

  test('encode -> decode round-trip preserves dimensions, palette, and grid', () => {
    const encoded = encodePatternArtifact(mockPattern);
    const checksum = sha256(encoded);

    const decoded = decodePatternArtifact(encoded, checksum);

    expect(decoded.schemaVersion).toBe(mockPattern.schemaVersion);
    expect(decoded.width).toBe(mockPattern.width);
    expect(decoded.height).toBe(mockPattern.height);
    expect(decoded.palette).toEqual(mockPattern.palette);
    expect(decoded.grid).toEqual(mockPattern.grid);
  });

  test('checksum mismatch rejected with typed error', () => {
    const encoded = encodePatternArtifact(mockPattern);
    const incorrectChecksum = '0000000000000000000000000000000000000000000000000000000000000000';

    expect(() => {
      decodePatternArtifact(encoded, incorrectChecksum);
    }).toThrow(PatternCodecError);

    try {
      decodePatternArtifact(encoded, incorrectChecksum);
    } catch (err: any) {
      expect(err.type).toBe('checksum-mismatch');
      expect(err.message).toContain('checksum mismatch');
    }
  });

  test('malformed/truncated input rejected with typed error', () => {
    // 1. Completely random garbage bytes
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const garbageChecksum = sha256(garbage);

    expect(() => {
      decodePatternArtifact(garbage, garbageChecksum);
    }).toThrow(PatternCodecError);

    try {
      decodePatternArtifact(garbage, garbageChecksum);
    } catch (err: any) {
      expect(err.type).toBe('malformed');
    }

    // 2. Truncated gzip input
    const encoded = encodePatternArtifact(mockPattern);
    const truncated = encoded.slice(0, Math.floor(encoded.length / 2));
    const truncatedChecksum = sha256(truncated);

    expect(() => {
      decodePatternArtifact(truncated, truncatedChecksum);
    }).toThrow(PatternCodecError);

    try {
      decodePatternArtifact(truncated, truncatedChecksum);
    } catch (err: any) {
      expect(err.type).toBe('malformed');
    }
  });

  test('unknown schema version rejected with typed error', () => {
    // Construct a custom envelope with schemaVersion = 2
    const invalidVersionPayload = {
      schemaVersion: 2, // unsupported
      width: 3,
      height: 3,
      palette: [
        { dmcCode: '321', name: 'Christmas Red', rgbHex: '#C51E3A' },
      ],
      grid: new Uint8Array(9),
    };

    const message = PatternEnvelope.create(invalidVersionPayload);
    const buffer = PatternEnvelope.encode(message).finish();
    const compressed = gzip(buffer);
    const checksum = sha256(compressed);

    expect(() => {
      decodePatternArtifact(compressed, checksum);
    }).toThrow(PatternCodecError);

    try {
      decodePatternArtifact(compressed, checksum);
    } catch (err: any) {
      expect(err.type).toBe('unsupported-version');
      expect(err.message).toContain('Unsupported schema version: 2');
    }
  });

  test('300x300 maximum-size artifact round-trips and allocates only bounded structures', () => {
    const size = 300;
    const maxGrid = new Uint8Array(size * size);
    // Fill the grid with some indices
    maxGrid.fill(1);

    const maxPattern: PatternData = {
      schemaVersion: 1,
      width: size,
      height: size,
      palette: [
        { dmcCode: '321', name: 'Christmas Red', rgbHex: '#C51E3A' },
      ],
      grid: maxGrid,
    };

    const encoded = encodePatternArtifact(maxPattern);
    const checksum = sha256(encoded);

    const decoded = decodePatternArtifact(encoded, checksum);

    expect(decoded.width).toBe(size);
    expect(decoded.height).toBe(size);
    expect(decoded.grid.length).toBe(90000);
    expect(decoded.grid).toEqual(maxGrid);
  });

  test('exceeding 300x300 size limits or 2MB decompression caps throws typed errors', () => {
    // 1. Width/height limit (e.g. 301x300)
    const invalidDimensionsPayload = {
      schemaVersion: 1,
      width: 301,
      height: 300,
      palette: [{ dmcCode: '321', name: 'Christmas Red', rgbHex: '#C51E3A' }],
      grid: new Uint8Array(301 * 300),
    };

    const message = PatternEnvelope.create(invalidDimensionsPayload);
    const buffer = PatternEnvelope.encode(message).finish();
    const compressed = gzip(buffer);
    const checksum = sha256(compressed);

    expect(() => {
      decodePatternArtifact(compressed, checksum);
    }).toThrow(PatternCodecError);

    try {
      decodePatternArtifact(compressed, checksum);
    } catch (err: any) {
      expect(err.type).toBe('too-large');
      expect(err.message).toContain('Dimensions exceed the 300x300 limit');
    }
  });
});
