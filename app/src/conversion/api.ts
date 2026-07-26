import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { apiFetch } from '@/api/apiFetch';
import { absoluteThumbnailUrls } from '@/api/catalog';
import { Config } from '@/config';
import type { ConversionProfile } from './profiles';
import { markCriticalPathActivity } from '@/perf/criticalPathSentinel';
import type { PatternThumbnailUrls } from '../pattern-assets';

export interface PersonalPattern {
  createdAt: string;
  height: number;
  id: string;
  paletteSize: number;
  previewUrl: string;
  thumbnailUrls?: PatternThumbnailUrls | null;
  title: string;
  width: number;
}

interface ConversionJob {
  errorMessage: string | null;
  id: string;
  pattern: PersonalPattern | null;
  status: 'pending' | 'dispatched' | 'running' | 'completed' | 'failed';
}

export interface PendingConversion {
  id: string;
  supportReference: string;
}

export async function createPhotoConversion(input: {
  maxColors: number;
  profile: ConversionProfile;
  shortEdgeCells: number;
  title: string;
  uploadUri: string;
}): Promise<PendingConversion> {
  markCriticalPathActivity('conversion', 'createPhotoConversion');
  const body = new FormData();
  body.append('profile', input.profile);
  body.append('title', input.title);
  if (input.profile === 'custom') {
    body.append('shortEdgeCells', String(input.shortEdgeCells));
    body.append('maxColors', String(input.maxColors));
  }
  if (Platform.OS === 'web') {
    const file = await fetch(input.uploadUri).then((response) => response.blob());
    body.append('artwork', file, 'conversion-upload.jpg');
  } else {
    // Expo's WinterCG fetch rejects React Native's { uri, name, type } FormData
    // parts ("Unsupported FormDataPart implementation"), so hand it a File that
    // implements the Blob interface instead.
    body.append('artwork', new File(input.uploadUri) as unknown as Blob, 'conversion-upload.jpg');
  }

  const response = await apiFetch('/v1/conversions/photo', {
    body,
    method: 'POST',
  });
  if (!response.ok) {
    const message = await readServerMessage(response);
    throw new Error(message ?? `Conversion request failed (${response.status})`);
  }
  const result = (await response.json()) as { id?: unknown; supportReference?: unknown };
  if (typeof result.id !== 'string' || typeof result.supportReference !== 'string') {
    throw new Error('Conversion request response was malformed');
  }
  return { id: result.id, supportReference: result.supportReference };
}

export async function waitForConversion(
  jobId: string,
  onStatus?: (status: ConversionJob['status']) => void,
  supportReference?: string,
): Promise<PersonalPattern> {
  markCriticalPathActivity('conversion', 'waitForConversion');
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await apiFetch(`/v1/conversions/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Could not read Pattern Conversion (${response.status})`);
    }
    const job = (await response.json()) as ConversionJob;
    onStatus?.(job.status);
    if (job.status === 'completed' && job.pattern !== null) {
      return withAbsolutePreviewUrl(job.pattern);
    }
    if (job.status === 'failed') {
      throw new Error(withSupportReference(job.errorMessage ?? 'Pattern Conversion failed', supportReference));
    }
    await delay(1200);
  }
  throw new Error(withSupportReference('Pattern Conversion is still processing. Try again shortly.', supportReference));
}

function withSupportReference(message: string, supportReference: string | undefined): string {
  return supportReference === undefined ? message : `${message}\nSupport Reference: ${supportReference}`;
}

export async function listPersonalPatterns(): Promise<PersonalPattern[]> {
  const response = await apiFetch('/v1/conversions/patterns');
  if (!response.ok) {
    throw new Error(`Could not load Personal Patterns (${response.status})`);
  }
  const body = (await response.json()) as PersonalPattern[];
  return body.map(withAbsolutePreviewUrl);
}

function withAbsolutePreviewUrl(pattern: PersonalPattern): PersonalPattern {
  return {
    ...pattern,
    previewUrl: pattern.previewUrl.startsWith('http')
      ? pattern.previewUrl
      : `${Config.apiBaseUrl}${pattern.previewUrl}`,
    thumbnailUrls: absoluteThumbnailUrls(pattern.thumbnailUrls),
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
