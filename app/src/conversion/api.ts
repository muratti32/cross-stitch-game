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

// #168: shaped like EconomyApiError/MembershipApiError (ad287a4) so a caught
// Pattern Conversion HTTP failure routes through localizeServerError instead
// of the server's raw English message. The backend does not send a `reason`
// code for this module's endpoints today, so `reason` is always null -
// localizeServerError still resolves that to the generic localized failure
// plus a Support Reference.
export class ConversionApiError extends Error {
  constructor(readonly status: number, message: string, readonly reason: string | null) {
    super(message);
    this.name = 'ConversionApiError';
  }
}

/**
 * The terminal failure of a Processing Job for Pattern Conversion, read from
 * a 200 response body rather than an HTTP error - there is no `status`/
 * `reason` pair to route through localizeServerError. `job.errorMessage` is
 * backend/worker-authored diagnostic text (ADR-0051: never rendered to
 * players), so it is deliberately dropped here rather than carried onto
 * this error; only the opaque Support Reference survives for display.
 */
export class ConversionTerminalFailureError extends Error {
  constructor(readonly supportReference: string | undefined) {
    super('Pattern Conversion failed');
    this.name = 'ConversionTerminalFailureError';
  }
}

/** Polling for the Processing Job's terminal state exceeded its deadline. */
export class ConversionTimeoutError extends Error {
  constructor(readonly supportReference: string | undefined) {
    super('Pattern Conversion is still processing');
    this.name = 'ConversionTimeoutError';
  }
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
    const { message, reason } = await readServerError(response);
    throw new ConversionApiError(response.status, message ?? `Conversion request failed (${response.status})`, reason);
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
      const { message, reason } = await readServerError(response);
      throw new ConversionApiError(
        response.status,
        message ?? `Could not read Pattern Conversion (${response.status})`,
        reason,
      );
    }
    const job = (await response.json()) as ConversionJob;
    onStatus?.(job.status);
    if (job.status === 'completed' && job.pattern !== null) {
      return withAbsolutePreviewUrl(job.pattern);
    }
    if (job.status === 'failed') {
      throw new ConversionTerminalFailureError(supportReference);
    }
    await delay(1200);
  }
  throw new ConversionTimeoutError(supportReference);
}

export async function listPersonalPatterns(): Promise<PersonalPattern[]> {
  const response = await apiFetch('/v1/conversions/patterns');
  if (!response.ok) {
    const { message, reason } = await readServerError(response);
    throw new ConversionApiError(response.status, message ?? `Could not load Personal Patterns (${response.status})`, reason);
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

async function readServerError(response: Response): Promise<{ message: string | null; reason: string | null }> {
  try {
    const body = (await response.json()) as { message?: unknown; reason?: unknown };
    let message: string | null = null;
    if (typeof body.message === 'string') {
      message = body.message;
    } else if (Array.isArray(body.message)) {
      message = body.message.filter((item): item is string => typeof item === 'string').join(', ');
    }
    return { message, reason: typeof body.reason === 'string' ? body.reason : null };
  } catch {
    // The status fallback remains actionable when the server has no JSON body.
    return { message: null, reason: null };
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
