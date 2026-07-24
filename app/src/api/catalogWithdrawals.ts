import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './apiFetch';

export interface CatalogWithdrawalResult {
  created: boolean;
  withdrawal: {
    closedRecords: {
      fromStatus: string;
      recordId: string;
      recordType: 'metadata_appeal' | 'metadata_revision';
      toStatus: string;
    }[];
    createdAt: string;
    id: string;
    patternId: string;
    status: 'withdrawn';
  };
}

export async function withdrawCommunityPattern(
  patternId: string,
): Promise<CatalogWithdrawalResult> {
  const response = await apiFetch(`/v1/catalog/patterns/${patternId}/withdraw`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(await readMessage(response, 'Could not withdraw this pattern'));
  }
  return (await response.json()) as CatalogWithdrawalResult;
}

export function useWithdrawCommunityPattern(accountId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: withdrawCommunityPattern,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
      void queryClient.invalidateQueries({
        queryKey: ['catalog-metadata-revisions', 'patterns-mine', accountId],
      });
    },
  });
}

async function readMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') return body.message;
    if (Array.isArray(body.message)) {
      return body.message
        .filter((item): item is string => typeof item === 'string')
        .join(', ');
    }
  } catch {
    // Preserve the fallback for empty or non-JSON error responses.
  }
  return `${fallback} (${response.status})`;
}
