import { useMutation } from '@tanstack/react-query';

import { apiFetch } from './apiFetch';

export const COMMUNITY_REPORT_REASONS = [
  'inappropriate_or_unsafe_content',
  'copyright_or_publication_rights',
  'duplicate_or_spam',
  'misleading_title_or_tags',
  'other',
] as const;

export type CommunityReportReason = (typeof COMMUNITY_REPORT_REASONS)[number];

export interface CreateCommunityReportInput {
  explanation?: string;
  reason: CommunityReportReason;
}

export interface CommunityReportResult {
  created: boolean;
  report: {
    createdAt: string;
    explanation: string | null;
    id: string;
    reason: CommunityReportReason;
    reviewId: string;
  };
  review: {
    id: string;
    openedAt: string;
    status: 'open';
  };
}

export function communityReportValidationError(
  input: Partial<CreateCommunityReportInput>,
): string | null {
  if (input.reason === undefined) return 'Choose a report reason.';
  if (input.reason === 'other' && !input.explanation?.trim()) {
    return 'Explain why you are reporting this pattern.';
  }
  if ((input.explanation?.trim().length ?? 0) > 2000) {
    return 'The explanation must be 2,000 characters or fewer.';
  }
  if (input.explanation?.trim() && !/[\p{L}\p{N}]/u.test(input.explanation)) {
    return 'The explanation must include letters or numbers.';
  }
  return null;
}

export async function createCommunityReport(
  patternId: string,
  input: CreateCommunityReportInput,
): Promise<CommunityReportResult> {
  const validationError = communityReportValidationError(input);
  if (validationError !== null) throw new Error(validationError);

  const response = await apiFetch(`/v1/catalog/patterns/${patternId}/reports`, {
    body: JSON.stringify({
      explanation: input.explanation?.trim() || undefined,
      reason: input.reason,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(await readMessage(response));
  }
  return (await response.json()) as CommunityReportResult;
}

export function useCreateCommunityReport() {
  return useMutation({
    mutationFn: ({
      input,
      patternId,
    }: {
      input: CreateCommunityReportInput;
      patternId: string;
    }) => createCommunityReport(patternId, input),
  });
}

async function readMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') return body.message;
    if (Array.isArray(body.message)) {
      return body.message
        .filter((item): item is string => typeof item === 'string')
        .join(', ');
    }
  } catch {
    // Keep the stable fallback when the response is not JSON.
  }
  return `Could not submit this report (${response.status})`;
}
