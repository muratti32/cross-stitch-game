import * as protobuf from 'protobufjs';
import { gzip, Inflate } from 'pako';
import { sha256 } from 'js-sha256';

export type PatternCodecErrorType =
  | 'checksum-mismatch'
  | 'too-large'
  | 'malformed'
  | 'unsupported-version';

export class PatternCodecError extends Error {
  constructor(public type: PatternCodecErrorType, message: string) {
    super(message);
    this.name = 'PatternCodecError';
    Object.setPrototypeOf(this, PatternCodecError.prototype);
  }
}

export interface PaletteEntry {
  dmcCode: string;
  name: string;
  rgbHex: string;
}

export interface PatternData {
  schemaVersion: number;
  width: number;
  height: number;
  palette: PaletteEntry[];
  grid: Uint8Array;
}

interface PatternEnvelopeMessage {
  schemaVersion?: number;
  width?: number;
  height?: number;
  palette?: { dmcCode?: string; name?: string; rgbHex?: string }[];
  grid?: Uint8Array;
}

// Protobuf schema JSON definition for runtime setup without filesystem access
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

const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;

// Streaming decompression so oversized (zip-bomb) input is never buffered past
// the cap: pako delivers inflated chunks incrementally and anything beyond the
// limit is discarded instead of accumulated.
function ungzipBounded(bytes: Uint8Array, cap: number): Uint8Array {
  const inflator = new Inflate();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let exceeded = false;

  inflator.onData = (chunk: Uint8Array) => {
    const data = chunk;
    total += data.length;
    if (total > cap) {
      exceeded = true;
      return;
    }
    chunks.push(data);
  };

  inflator.push(bytes, true);

  if (exceeded) {
    throw new PatternCodecError(
      'too-large',
      `Decompressed envelope size (${total} bytes or more) exceeds the ${cap} byte cap.`
    );
  }
  if (inflator.err !== 0) {
    throw new PatternCodecError(
      'malformed',
      `Failed to decompress gzip content: ${inflator.msg || `pako error ${inflator.err}`}`
    );
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Encodes pattern data into a gzip-compressed Protocol Buffers envelope.
 */
export function encodePatternArtifact(pattern: PatternData): Uint8Array {
  if (pattern.schemaVersion !== 1) {
    throw new Error(`Unsupported schema version for encoding: ${pattern.schemaVersion}`);
  }
  if (pattern.width <= 0 || pattern.width > 300 || pattern.height <= 0 || pattern.height > 300) {
    throw new Error(`Invalid dimensions for encoding: ${pattern.width}x${pattern.height}`);
  }
  const expectedGridLength = pattern.width * pattern.height;
  if (pattern.grid.length !== expectedGridLength) {
    throw new Error(`Grid size mismatch for encoding: expected ${expectedGridLength}, got ${pattern.grid.length}`);
  }
  const paletteLength = pattern.palette.length;
  for (let i = 0; i < pattern.grid.length; i++) {
    const cell = pattern.grid[i];
    if (cell < 0 || cell > paletteLength) {
      throw new Error(
        `Out-of-range cell index at position ${i} during encoding: ${cell} (palette size: ${paletteLength})`
      );
    }
  }

  const payload = {
    schemaVersion: pattern.schemaVersion,
    width: pattern.width,
    height: pattern.height,
    palette: pattern.palette.map((entry) => ({
      dmcCode: entry.dmcCode,
      name: entry.name,
      rgbHex: entry.rgbHex,
    })),
    grid: pattern.grid,
  };

  const message = PatternEnvelope.create(payload);
  const buffer = PatternEnvelope.encode(message).finish();
  return gzip(buffer);
}

/**
 * Decodes a gzip-compressed Protocol Buffers envelope into pattern data after validating its SHA-256 checksum.
 */
export function decodePatternArtifact(bytes: Uint8Array, expectedChecksum: string): PatternData {
  // 1. Verify SHA-256 checksum
  const computedChecksum = sha256(bytes);
  if (computedChecksum.toLowerCase() !== expectedChecksum.toLowerCase()) {
    throw new PatternCodecError(
      'checksum-mismatch',
      `SHA-256 checksum mismatch. Expected: ${expectedChecksum}, got: ${computedChecksum}`
    );
  }

  // 2. Enforce decompression size limits
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new PatternCodecError('malformed', 'Gzip binary is too short or lacks valid magic bytes');
  }

  const decompressed = ungzipBounded(bytes, MAX_DECOMPRESSED_BYTES);

  // 3. Decode protobuf
  let message: PatternEnvelopeMessage & protobuf.Message<{}>;
  try {
    message = PatternEnvelope.decode(decompressed) as PatternEnvelopeMessage & protobuf.Message<{}>;
  } catch (err) {
    throw new PatternCodecError(
      'malformed',
      `Failed to decode protobuf: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 4. Validate decoded fields
  if (message.schemaVersion !== 1) {
    throw new PatternCodecError(
      'unsupported-version',
      `Unsupported schema version: ${message.schemaVersion}. Only version 1 is supported.`
    );
  }

  const width = message.width;
  const height = message.height;
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
    throw new PatternCodecError('malformed', `Invalid dimensions: ${width}x${height}`);
  }
  if (width > 300 || height > 300) {
    throw new PatternCodecError('too-large', `Dimensions exceed the 300x300 limit: ${width}x${height}`);
  }

  if (!message.palette || !Array.isArray(message.palette)) {
    throw new PatternCodecError('malformed', 'Palette is missing or invalid');
  }

  const palette: PaletteEntry[] = [];
  for (let i = 0; i < message.palette.length; i++) {
    const entry = message.palette[i];
    if (
      typeof entry.dmcCode !== 'string' ||
      typeof entry.name !== 'string' ||
      typeof entry.rgbHex !== 'string'
    ) {
      throw new PatternCodecError('malformed', `Palette contains invalid entry at index ${i}`);
    }
    palette.push({
      dmcCode: entry.dmcCode,
      name: entry.name,
      rgbHex: entry.rgbHex,
    });
  }

  if (!(message.grid instanceof Uint8Array)) {
    throw new PatternCodecError('malformed', 'Grid is missing or invalid');
  }

  const expectedGridLength = width * height;
  if (message.grid.length !== expectedGridLength) {
    throw new PatternCodecError(
      'malformed',
      `Grid size mismatch: expected ${expectedGridLength} bytes (${width}x${height}), got ${message.grid.length} bytes`
    );
  }

  const paletteLength = palette.length;
  for (let i = 0; i < message.grid.length; i++) {
    const cell = message.grid[i];
    if (cell < 0 || cell > paletteLength) {
      throw new PatternCodecError(
        'malformed',
        `Out-of-range cell index at position ${i}: ${cell} (palette size: ${paletteLength})`
      );
    }
  }

  return {
    schemaVersion: message.schemaVersion,
    width,
    height,
    palette,
    grid: message.grid,
  };
}
