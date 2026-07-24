'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { PatternStatusBadge } from '@/components/common/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  useApplyReviewHold,
  usePostPublicationReview,
} from '@/hooks/use-post-publication-reviews';
import { ApiError } from '@/lib/client/fetcher';
import { formatDateTime } from '@/lib/format';
import { toConsolePreviewSrc } from '@/lib/preview-url';
import type { CommunityReportReason } from '@/lib/types';

const REASON_LABELS: Record<CommunityReportReason, string> = {
  copyright_or_publication_rights: 'Copyright or Publication Rights',
  duplicate_or_spam: 'Duplicate or Spam',
  inappropriate_or_unsafe_content: 'Inappropriate or Unsafe Content',
  misleading_title_or_tags: 'Misleading Title or Tags',
  other: 'Other',
};

export function PostPublicationReviewDetailView({ reviewId }: { reviewId: string }) {
  const query = usePostPublicationReview(reviewId);
  const hold = useApplyReviewHold(reviewId);
  const [reason, setReason] = useState('');

  if (query.isPending) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        message={
          query.error instanceof ApiError
            ? query.error.message
            : 'Failed to load this Post-Publication Review.'
        }
        onRetry={() => void query.refetch()}
      />
    );
  }

  const review = query.data;
  const canApplyHold =
    review.status === 'open' &&
    review.holdAppliedAt === null &&
    review.pattern.status === 'available';

  return (
    <div>
      <Link
        href="/post-publication-reviews"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Post-Publication Reviews
      </Link>
      <PageHeader
        title={review.pattern.title}
        description={`Review opened ${formatDateTime(review.openedAt)}`}
        actions={<PatternStatusBadge status={review.pattern.status} />}
      />

      {review.holdAppliedAt !== null && (
        <Alert className="mb-6">
          <ShieldAlert />
          <AlertTitle>Review Hold active</AlertTitle>
          <AlertDescription>
            Applied {formatDateTime(review.holdAppliedAt)}. {review.holdReason}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <Image
            src={toConsolePreviewSrc(review.pattern.previewUrl)}
            alt={`Preview of ${review.pattern.title}`}
            width={360}
            height={360}
            unoptimized
            className="aspect-square w-full rounded-lg border border-border object-contain"
          />
          <Card>
            <CardHeader><CardTitle>Current catalog state</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Fact label="Category" value={review.pattern.categoryCode} />
              <Fact label="Tags" value={review.pattern.tagCodes.join(', ') || '—'} />
              <Fact label="Language" value={review.pattern.sourceLanguage ?? '—'} />
              <Fact label="Pattern ID" value={review.pattern.id} />
              <Fact label="Metadata revision" value={review.metadataRevisionId ?? '—'} />
              <p className="pt-2 text-xs leading-5 text-muted-foreground">
                {review.pattern.description}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Structured Community Report evidence</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {review.reports.map((report) => (
                <div key={report.id} className="rounded-lg border p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="secondary">{REASON_LABELS[report.reason]}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(report.createdAt)}
                    </span>
                  </div>
                  {report.explanation !== null && (
                    <p className="mt-3 whitespace-pre-wrap leading-6">{report.explanation}</p>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Reporter identities are not included in this decision surface or in owner notices.
              </p>
            </CardContent>
          </Card>

          {canApplyHold && (
            <Card>
              <CardHeader><CardTitle>Human moderator action</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="review-hold-reason">Owner-visible reason</Label>
                  <Textarea
                    id="review-hold-reason"
                    maxLength={2000}
                    placeholder="Explain why this Pattern is temporarily under Review Hold. Do not include reporter details."
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>
                <ConfirmActionDialog
                  trigger={
                    <Button disabled={reason.trim().length === 0} variant="destructive">
                      Apply Review Hold
                    </Button>
                  }
                  title="Apply Review Hold?"
                  description="This explicit moderator decision removes the Community Pattern from discovery and blocks new Stitching Sessions. Existing sessions, progress, Offline Pattern Data, and existing-session artifact grants remain available. The owner receives one in-app notice and one idempotent email."
                  confirmLabel="Apply Review Hold"
                  destructive
                  onConfirm={async () => {
                    await hold.mutateAsync(reason.trim());
                    toast.success('Review Hold applied and owner notice queued.');
                  }}
                />
                {hold.error !== null && (
                  <p className="text-sm text-destructive">{hold.error.message}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all text-right">{value}</span>
    </div>
  );
}
