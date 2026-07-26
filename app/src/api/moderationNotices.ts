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

export async function listModerationNotices(): Promise<ModerationNotice[]> {
  const response = await apiFetch('/v1/moderation-notices');
  if (!response.ok) {
    throw new Error(await readMessage(response, 'Could not load Moderation Notices'));
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

async function readMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') return body.message;
  } catch {
    // Preserve the actionable fallback when the server did not return JSON.
  }
  return `${fallback} (${response.status})`;
}
