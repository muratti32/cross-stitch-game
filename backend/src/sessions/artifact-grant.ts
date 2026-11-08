import { createHmac } from 'node:crypto';

export interface ArtifactGrantPattern {
  id: string;
  artifactByteLength: number;
  artifactChecksum: string;
  artifactSchemaVersion: number;
}

export function signArtifactGrant(secret: string, patternId: string, exp: number): string {
  return createHmac('sha256', secret).update(`${patternId}:${exp}`).digest('hex');
}

/** Short-lived signed download grant for a Pattern Artifact; see `ArtifactsController`. */
export function buildArtifactGrant(secret: string, ttlSeconds: number, pattern: ArtifactGrantPattern) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signArtifactGrant(secret, pattern.id, exp);
  return {
    artifact: {
      byteLength: pattern.artifactByteLength,
      checksum: pattern.artifactChecksum.trim(),
      schemaVersion: pattern.artifactSchemaVersion,
    },
    grant: {
      expiresAt: new Date(exp * 1000).toISOString(),
      url: `/v1/artifacts/${pattern.id}?exp=${exp}&sig=${sig}`,
    },
    patternId: pattern.id,
  };
}
