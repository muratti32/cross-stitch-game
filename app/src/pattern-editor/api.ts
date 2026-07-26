import { apiFetch } from '@/api/apiFetch';
import { absoluteThumbnailUrls } from '@/api/catalog';
import { Config } from '@/config';
import { decodePatternArtifact } from '@/pattern-artifact';
import type { PatternData } from '@/pattern-artifact';
import type { PatternThumbnailUrls } from '../pattern-assets';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface DmcColor {
  dmcCode: string;
  name: string;
  rgbHex: string;
}

export async function listDmcColors(): Promise<DmcColor[]> {
  const response = await apiFetch('/v1/conversions/dmc-colors');
  if (!response.ok) {
    const message = await readServerMessage(response);
    throw new Error(message ?? `Could not load DMC colors (${response.status})`);
  }
  return response.json() as Promise<DmcColor[]>;
}

export interface PersonalPatternArtifactGrant {
  artifactUrl: string;
  checksum: string;
  byteLength: number;
  schemaVersion: number;
  width: number;
  height: number;
  title: string;
}

export async function getPersonalPatternArtifactGrant(patternId: string): Promise<PersonalPatternArtifactGrant> {
  const response = await apiFetch(`/v1/conversions/personal-patterns/${patternId}/artifact-grant`);
  if (!response.ok) {
    const message = await readServerMessage(response);
    throw new Error(message ?? `Could not get artifact grant (${response.status})`);
  }
  const body = (await response.json()) as PersonalPatternArtifactGrant;
  return withAbsoluteArtifactUrl(body);
}

export async function downloadPersonalPatternArtifact(
  grant: PersonalPatternArtifactGrant,
): Promise<PatternData> {
  // Reuse apiFetch since it handles apiBaseUrl prefixing and does not force JSON content-type or response parsing.
  const response = await apiFetch(grant.artifactUrl);
  if (!response.ok) {
    throw new Error(`Artifact download failed (${response.status})`);
  }
  const buf = await response.arrayBuffer();
  const bytes = new Uint8Array(buf);
  return decodePatternArtifact(bytes, grant.checksum);
}

export interface CreateDerivedPatternInput {
  patternId: string;
  sourcePatternId: string;
  title: string;
  width: number;
  height: number;
  palette: DmcColor[];
  grid: string; // base64
}

export interface CreateDerivedPatternResult {
  id: string;
  title: string;
  width: number;
  height: number;
  previewUrl: string;
  thumbnailUrls?: PatternThumbnailUrls | null;
  alreadyExists: boolean;
}

export async function createDerivedPattern(
  input: CreateDerivedPatternInput,
): Promise<CreateDerivedPatternResult> {
  const response = await apiFetch('/v1/conversions/personal-patterns/derived', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const message = await readServerMessage(response);
    throw new ApiError(message ?? `Create derived pattern failed (${response.status})`, response.status);
  }
  const body = (await response.json()) as CreateDerivedPatternResult;
  return withAbsolutePreviewUrl(body);
}

function withAbsoluteArtifactUrl(grant: PersonalPatternArtifactGrant): PersonalPatternArtifactGrant {
  return {
    ...grant,
    artifactUrl: grant.artifactUrl.startsWith('http')
      ? grant.artifactUrl
      : `${Config.apiBaseUrl}${grant.artifactUrl}`,
  };
}

function withAbsolutePreviewUrl<T extends {
  previewUrl: string;
  thumbnailUrls?: PatternThumbnailUrls | null;
}>(result: T): T {
  return {
    ...result,
    previewUrl: result.previewUrl.startsWith('http')
      ? result.previewUrl
      : `${Config.apiBaseUrl}${result.previewUrl}`,
    thumbnailUrls: absoluteThumbnailUrls(result.thumbnailUrls),
  };
}

async function readServerMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') {
      return body.message;
    }
    if (Array.isArray(body.message)) {
      return body.message.filter((item): item is string => typeof item === 'string').join(', ');
    }
  } catch {
    // The status fallback remains actionable when the server has no JSON body.
  }
  return null;
}
