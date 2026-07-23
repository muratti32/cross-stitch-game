import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './apiFetch';

export type CatalogSubmissionStatus =
  | 'precheck_pending'
  | 'review_pending'
  | 'quarantined'
  | 'precheck_failed'
  | 'rejected'
  | 'appeal_pending'
  | 'appeal_upheld'
  | 'accepted';

export type CatalogRejectionReason =
  | 'safety'
  | 'publication_rights'
  | 'duplicate_or_spam'
  | 'technical_invalidity'
  | 'quality_standard';

export interface CatalogSubmission {
  appealed: boolean;
  categoryCode: string;
  communityPatternId: string | null;
  createdAt: string;
  description: string;
  id: string;
  licenseVersion: 'v1';
  metadataErrors: string[];
  metadataValid: boolean | null;
  rejectionNote: string | null;
  rejectionReason: CatalogRejectionReason | null;
  sourceLanguage: 'en';
  sourcePatternId: string;
  status: CatalogSubmissionStatus;
  tagCodes: string[];
  technicalErrors: string[];
  technicalValid: boolean | null;
  title: string;
  updatedAt: string;
}

export interface CreateCatalogSubmissionInput {
  categoryCode: string;
  description: string;
  licenseVersion: 'v1';
  rightsDeclared: true;
  sourceLanguage: 'en';
  tagCodes: string[];
  title: string;
}

function submissionsKey(accountId: string | null) {
  return ['catalog-submissions', 'me', accountId] as const;
}

export async function createCatalogSubmission(
  patternId: string,
  input: CreateCatalogSubmissionInput,
): Promise<CatalogSubmission> {
  return catalogSubmissionRequest<CatalogSubmission>(
    `/v1/catalog-submissions/patterns/${patternId}`,
    { body: JSON.stringify(input), headers: { 'content-type': 'application/json' }, method: 'POST' },
    'Could not submit this pattern',
  );
}

export async function listCatalogSubmissions(): Promise<CatalogSubmission[]> {
  return catalogSubmissionRequest<CatalogSubmission[]>(
    '/v1/catalog-submissions/me',
    undefined,
    'Could not load your Catalog Submissions',
  );
}

export async function createCatalogAppeal(id: string, note?: string): Promise<void> {
  await catalogSubmissionRequest(
    `/v1/catalog-submissions/${id}/appeal`,
    {
      body: JSON.stringify({ note: note?.trim() || undefined }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    'Could not submit this appeal',
  );
}

export function useCatalogSubmissions(accountId: string | null, enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: listCatalogSubmissions,
    queryKey: submissionsKey(accountId),
  });
}

export function useCreateCatalogSubmission(accountId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patternId, input }: { patternId: string; input: CreateCatalogSubmissionInput }) =>
      createCatalogSubmission(patternId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: submissionsKey(accountId) }),
  });
}

export function useCreateCatalogAppeal(accountId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => createCatalogAppeal(id, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: submissionsKey(accountId) }),
  });
}

async function catalogSubmissionRequest<T>(
  path: string,
  options: RequestInit | undefined,
  fallback: string,
): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) throw new Error(await readMessage(response, fallback));
  return (await response.json()) as T;
}

async function readMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') return body.message;
    if (Array.isArray(body.message)) {
      return body.message.filter((item): item is string => typeof item === 'string').join(', ');
    }
  } catch {
    // Preserve the actionable fallback when the server did not return JSON.
  }
  return `${fallback} (${response.status})`;
}
