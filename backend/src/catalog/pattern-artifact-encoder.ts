import { createHash } from 'node:crypto';
import * as zlib from 'node:zlib';

import * as protobuf from 'protobufjs';

// Pattern Artifact v1 (ADR-0018): gzip-compressed protobuf envelope. This is
// the cross-runtime contract shared with the mobile client decoder
// (app/src/pattern-artifact) and, later, the Conversion Engine pipeline.
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

export interface ArtifactPaletteEntry {
  dmcCode: string;
  name: string;
  rgbHex: string;
}

export interface PatternArtifactInput {
  width: number;
  height: number;
  palette: ArtifactPaletteEntry[];
  grid: Uint8Array;
}

export interface EncodedPatternArtifact {
  bytes: Buffer;
  checksum: string;
  byteLength: number;
  schemaVersion: 1;
}

export function encodePatternArtifactV1(
  input: PatternArtifactInput,
): EncodedPatternArtifact {
  if (
    input.width < 1 ||
    input.width > 300 ||
    input.height < 1 ||
    input.height > 300
  ) {
    throw new RangeError(
      `Pattern dimensions out of range: ${input.width}x${input.height}`,
    );
  }
  if (input.grid.length !== input.width * input.height) {
    throw new RangeError(
      `Grid length ${input.grid.length} does not match ${input.width}x${input.height}`,
    );
  }
  for (let i = 0; i < input.grid.length; i++) {
    if (input.grid[i] > input.palette.length) {
      throw new RangeError(
        `Cell ${i} references palette index ${input.grid[i]} beyond palette size ${input.palette.length}`,
      );
    }
  }

  const message = PatternEnvelope.create({
    schemaVersion: 1,
    width: input.width,
    height: input.height,
    palette: input.palette,
    grid: input.grid,
  });
  const protoBytes = PatternEnvelope.encode(message).finish();
  // Fixed compression level keeps identical input byte-identical across runs.
  const bytes = zlib.gzipSync(protoBytes, { level: 9 });
  const checksum = createHash('sha256').update(bytes).digest('hex');
  return { bytes, checksum, byteLength: bytes.length, schemaVersion: 1 };
}

export interface DecodedPatternArtifact {
  schemaVersion: number;
  width: number;
  height: number;
  palette: ArtifactPaletteEntry[];
  grid: Uint8Array;
}

export function decodePatternArtifactV1(bytes: Buffer): DecodedPatternArtifact {
  const decompressed = zlib.gunzipSync(bytes, { maxOutputLength: 2 * 1024 * 1024 });
  const message = PatternEnvelope.decode(decompressed) as unknown as {
    schemaVersion: number;
    width: number;
    height: number;
    palette: ArtifactPaletteEntry[];
    grid: Uint8Array;
  };
  return {
    schemaVersion: message.schemaVersion,
    width: message.width,
    height: message.height,
    palette: message.palette.map((entry) => ({
      dmcCode: entry.dmcCode,
      name: entry.name,
      rgbHex: entry.rgbHex,
    })),
    grid: message.grid,
  };
}
