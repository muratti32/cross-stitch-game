import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './apiFetch';
import { PatternThumbnailUrls } from '../pattern-assets';

export type CatalogMetadataRevisionStatus =
  | 'pending'
  | 'rejected'
  | 'appeal_pending'
  | 'appeal_upheld'
  | 'accepted'
  | 'withdrawn';

export type CatalogRejectionReason =
  | 'safety'
  | 'publication_rights'
  | 'duplicate_or_spam'
  | 'technical_invalidity'
  | 'quality_standard';

export interface CatalogMetadataRevision {
  categoryCode: string;
  communityPatternId: string;
  createdAt: string;
  description: string;
  id: string;
  metadataErrors: string[];
  metadataValid: boolean | null;
  rejectionNote: string | null;
  rejectionReason: CatalogRejectionReason | null;
  sourceLanguage: 'en';
  status: CatalogMetadataRevisionStatus;
  tagCodes: string[];
  title: string;
  updatedAt: string;
}

export interface MyPublishedPattern {
  canSubmitRevision: boolean;
  categoryCode: string;
  description: string | null;
  id: string;
  latestRevision: CatalogMetadataRevision | null;
  publishedAt: string;
  sourceLanguage: string | null;
  status: 'available' | 'review_hold' | 'withdrawn';
  tagCodes: string[];
  title: string;
  previewUrl: string;
  thumbnailUrls: PatternThumbnailUrls | null;
}

export interface CreateCatalogMetadataRevisionInput {
  categoryCode: string;
  description: string;
  sourceLanguage: 'en';
  tagCodes: string[];
  title: string;
}

/**
 * #165: same (status, reason) shape as CatalogSubmissionApiError, so
 * isServerApiError/localizeServerError apply here too - see that class's
 * comment in catalogSubmissions.ts for the rationale.
 */
export class CatalogMetadataRevisionApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = 'CatalogMetadataRevisionApiError';
  }
}

function revisionsKey(accountId: string | null) {
  return ['catalog-metadata-revisions', 'me', accountId] as const;
}

function myPatternsKey(accountId: string | null) {
  return ['catalog-metadata-revisions', 'patterns-mine', accountId] as const;
}

export async function listMyPublishedPatterns(): Promise<MyPublishedPattern[]> {
  return catalogMetadataRevisionRequest<MyPublishedPattern[]>(
    '/v1/catalog-metadata-revisions/patterns/mine',
    undefined,
    'Could not load your published patterns',
  );
}

export async function createCatalogMetadataRevision(
  patternId: string,
  input: CreateCatalogMetadataRevisionInput,
): Promise<CatalogMetadataRevision> {
  return catalogMetadataRevisionRequest<CatalogMetadataRevision>(
    `/v1/catalog-metadata-revisions/patterns/${patternId}`,
    { body: JSON.stringify(input), headers: { 'content-type': 'application/json' }, method: 'POST' },
    'Could not submit this revision',
  );
}

export async function withdrawCatalogMetadataRevision(id: string): Promise<CatalogMetadataRevision> {
  return catalogMetadataRevisionRequest<CatalogMetadataRevision>(
    `/v1/catalog-metadata-revisions/${id}/withdraw`,
    { method: 'POST' },
    'Could not withdraw this revision',
  );
}

export async function appealCatalogMetadataRevision(id: string, note?: string): Promise<void> {
  await catalogMetadataRevisionRequest(
    `/v1/catalog-metadata-revisions/${id}/appeal`,
    {
      body: JSON.stringify({ note: note?.trim() || undefined }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    'Could not submit this appeal',
  );
}

export function useMyPublishedPatterns(accountId: string | null, enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: listMyPublishedPatterns,
    queryKey: myPatternsKey(accountId),
  });
}

export function useCreateCatalogMetadataRevision(accountId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patternId, input }: { patternId: string; input: CreateCatalogMetadataRevisionInput }) =>
      createCatalogMetadataRevision(patternId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: revisionsKey(accountId) });
      void queryClient.invalidateQueries({ queryKey: myPatternsKey(accountId) });
    },
  });
}

export function useWithdrawCatalogMetadataRevision(accountId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => withdrawCatalogMetadataRevision(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: revisionsKey(accountId) });
      void queryClient.invalidateQueries({ queryKey: myPatternsKey(accountId) });
    },
  });
}

export function useAppealCatalogMetadataRevision(accountId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => appealCatalogMetadataRevision(id, note),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: revisionsKey(accountId) });
      void queryClient.invalidateQueries({ queryKey: myPatternsKey(accountId) });
    },
  });
}

async function catalogMetadataRevisionRequest<T>(
  path: string,
  options: RequestInit | undefined,
  fallback: string,
): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) throw await revisionError(response, fallback);
  return (await response.json()) as T;
}

async function revisionError(response: Response, fallback: string): Promise<CatalogMetadataRevisionApiError> {
  let message = fallback;
  let reason: string | null = null;
  try {
    const body = (await response.json()) as { message?: unknown; reason?: unknown };
    if (typeof body.message === 'string') message = body.message;
    if (Array.isArray(body.message)) {
      message = body.message.filter((item): item is string => typeof item === 'string').join(', ');
    }
    if (typeof body.reason === 'string') reason = body.reason;
  } catch {
    // Preserve the actionable fallback when the server did not return JSON.
  }
  return new CatalogMetadataRevisionApiError(response.status, message, reason);
}
