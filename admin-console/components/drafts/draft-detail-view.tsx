'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { DraftStatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategories } from '@/hooks/use-categories';
import { useDiscardDraft, useDraft } from '@/hooks/use-drafts';
import { useTags } from '@/hooks/use-tags';
import { ApiError } from '@/lib/client/fetcher';
import { formatDateTime } from '@/lib/format';

import { DraftPublishForm } from './draft-publish-form';

export function DraftDetailView({ draftId }: { draftId: string }) {
  const draftQuery = useDraft(draftId);
  const categoriesQuery = useCategories();
  const tagsQuery = useTags();
  const discardMutation = useDiscardDraft(draftId);

  return (
    <div>
      <Link
        href="/drafts"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Drafts
      </Link>

      {draftQuery.isPending && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {draftQuery.isError && (
        <ErrorState
          message={
            draftQuery.error instanceof ApiError
              ? draftQuery.error.message
              : 'Failed to load this draft.'
          }
          onRetry={() => void draftQuery.refetch()}
        />
      )}

      {draftQuery.data !== undefined && (
        <>
          <PageHeader
            title="Official Pattern Draft"
            description={`Uploaded ${formatDateTime(draftQuery.data.createdAt)}`}
            actions={<DraftStatusBadge status={draftQuery.data.status} />}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
            <div className="space-y-4">
              {draftQuery.data.hasPreview ? (
                <Image
                  src={`/api/admin/pattern-drafts/${draftQuery.data.id}/preview`}
                  alt="Converted preview"
                  width={320}
                  height={320}
                  unoptimized
                  className="w-full rounded-lg border border-border object-cover"
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                  Preview not available yet
                </div>
              )}
              <Card>
                <CardContent className="space-y-2 pt-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Dimensions</span>
                    <span>
                      {draftQuery.data.width !== null && draftQuery.data.height !== null
                        ? `${draftQuery.data.width} × ${draftQuery.data.height} cells`
                        : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Palette size</span>
                    <span>{draftQuery.data.paletteSize ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Stitchable cells</span>
                    <span>{draftQuery.data.stitchableCellCount ?? '—'}</span>
                  </div>
                </CardContent>
              </Card>
              {draftQuery.data.status !== 'published' && draftQuery.data.status !== 'discarded' && (
                <ConfirmActionDialog
                  trigger={
                    <Button variant="outline" className="w-full">
                      Discard draft
                    </Button>
                  }
                  title="Discard this Official Pattern Draft?"
                  description="Discarding removes this draft from review. It will never appear in the Pattern Catalog. This cannot be undone."
                  confirmLabel="Discard"
                  destructive
                  onConfirm={async () => {
                    await discardMutation.mutateAsync();
                    toast.success('Draft discarded.');
                  }}
                />
              )}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>
                  {draftQuery.data.status === 'ready'
                    ? 'Publish this pattern'
                    : draftQuery.data.status === 'published'
                      ? 'Already published'
                      : draftQuery.data.status === 'failed'
                        ? 'Conversion failed'
                        : draftQuery.data.status === 'discarded'
                          ? 'Discarded'
                          : 'Converting…'}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {draftQuery.data.status === 'ready' &&
                  (categoriesQuery.isPending || tagsQuery.isPending ? (
                    <div className="space-y-3">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : categoriesQuery.isError || tagsQuery.isError ? (
                    <ErrorState message="Failed to load categories or tags for publishing." />
                  ) : (
                    <DraftPublishForm
                      draft={draftQuery.data}
                      categories={categoriesQuery.data ?? []}
                      tags={tagsQuery.data ?? []}
                    />
                  ))}

                {draftQuery.data.status === 'published' && draftQuery.data.publishedPatternId !== null && (
                  <p className="text-sm text-muted-foreground">
                    This draft has already been published.{' '}
                    <Link href={`/patterns/${draftQuery.data.publishedPatternId}`} className="underline">
                      View the Official Pattern
                    </Link>
                    .
                  </p>
                )}

                {draftQuery.data.status === 'failed' && (
                  <p className="text-sm text-destructive">
                    {draftQuery.data.failureReason ?? 'Conversion failed for an unknown reason.'}
                  </p>
                )}

                {draftQuery.data.status === 'discarded' && (
                  <p className="text-sm text-muted-foreground">This draft was discarded and cannot be published.</p>
                )}

                {(draftQuery.data.status === 'pending' || draftQuery.data.status === 'processing') && (
                  <p className="text-sm text-muted-foreground">
                    Converting the source image into a stitch grid and palette. This page updates automatically.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
