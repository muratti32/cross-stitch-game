import { useQuery } from '@tanstack/react-query';

import { apiFetch } from './apiFetch';

export type ModerationNoticeType =
  | 'review_hold'
  | 'no_violation'
  | 'metadata_remediation'
  | 'safety_removal';

export interface ModerationNotice {
  createdAt: string;
  id: string;
  noticeType: ModerationNoticeType;
  patternId: string;
  patternTitle: string;
  reason: string;
}

export class ModerationNoticesApiError extends Error {
  constructor(readonly status: number, message: string, readonly reason: string | null) {
    super(message);
    this.name = 'ModerationNoticesApiError';
  }
}

export async function listModerationNotices(): Promise<ModerationNotice[]> {
  const response = await apiFetch('/v1/moderation-notices');
  if (!response.ok) {
    throw await readError(response);
  }
  return (await response.json()) as ModerationNotice[];
}

export function useModerationNotices(accountId: string | null, enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: listModerationNotices,
    queryKey: ['moderation-notices', accountId],
  });
}

async function readError(response: Response): Promise<ModerationNoticesApiError> {
  let message = `Could not load Moderation Notices (${response.status})`;
  let reason: string | null = null;
  try {
    const body = (await response.json()) as { message?: unknown; reason?: unknown };
    if (typeof body.message === 'string') message = body.message;
    if (typeof body.reason === 'string') reason = body.reason;
  } catch {
    // Keep the diagnostic fallback.
  }
  return new ModerationNoticesApiError(response.status, message, reason);
}
