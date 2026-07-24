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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useCategories } from '@/hooks/use-categories';
import {
  useApplyCatalogMetadataRemediation,
  useApplyReviewHold,
  useCloseReviewNoViolation,
  usePostPublicationReview,
} from '@/hooks/use-post-publication-reviews';
import { useTags } from '@/hooks/use-tags';
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

const CLOSE_OUTCOME_LABELS = {
  metadata_remediation: 'Catalog Metadata Remediation applied',
  no_violation: 'Closed — no violation found',
};

export function PostPublicationReviewDetailView({ reviewId }: { reviewId: string }) {
  const query = usePostPublicationReview(reviewId);
  const categoriesQuery = useCategories();
  const tagsQuery = useTags();
  const hold = useApplyReviewHold(reviewId);
  const closeNoViolation = useCloseReviewNoViolation(reviewId);
  const remediate = useApplyCatalogMetadataRemediation(reviewId);
  const [reason, setReason] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [remediationReason, setRemediationReason] = useState('');
  const [removeTagCodes, setRemoveTagCodes] = useState<string[]>([]);
  const [remediationCategory, setRemediationCategory] = useState<string | null>(null);

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

      {review.status === 'open' && review.holdAppliedAt !== null && (
        <Alert className="mb-6">
          <ShieldAlert />
          <AlertTitle>Review Hold active</AlertTitle>
          <AlertDescription>
            Applied {formatDateTime(review.holdAppliedAt)}. {review.holdReason}
          </AlertDescription>
        </Alert>
      )}

      {review.status === 'closed' && review.closeOutcome !== null && (
        <Alert className="mb-6">
          <ShieldAlert />
          <AlertTitle>{CLOSE_OUTCOME_LABELS[review.closeOutcome]}</AlertTitle>
          <AlertDescription>
            {review.closedAt !== null && `Decided ${formatDateTime(review.closedAt)}. `}
            {review.closeReason}
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

          {review.status === 'open' && (
            <Card>
              <CardHeader><CardTitle>Close — no violation found</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="close-no-violation-reason">Owner-visible reason</Label>
                  <Textarea
                    id="close-no-violation-reason"
                    maxLength={2000}
                    placeholder="Explain why the report(s) did not identify a policy violation."
                    value={closeReason}
                    onChange={(event) => setCloseReason(event.target.value)}
                  />
                </div>
                <ConfirmActionDialog
                  trigger={
                    <Button disabled={closeReason.trim().length === 0} variant="secondary">
                      Close with no violation
                    </Button>
                  }
                  title="Close this Post-Publication Review?"
                  description="This restores normal discovery, new Stitching Sessions, and grant behavior, clears any active Review Hold, and resolves any pending Catalog Metadata Revision or appeal without publishing it. The owner receives one in-app notice and one idempotent email."
                  confirmLabel="Close with no violation"
                  onConfirm={async () => {
                    await closeNoViolation.mutateAsync(closeReason.trim());
                    toast.success('Post-Publication Review closed and owner notice queued.');
                  }}
                />
                {closeNoViolation.error !== null && (
                  <p className="text-sm text-destructive">{closeNoViolation.error.message}</p>
                )}
              </CardContent>
            </Card>
          )}

          {review.status === 'open' && (
            <Card>
              <CardHeader><CardTitle>Apply Catalog Metadata Remediation</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Replaces the title and description with a safe neutral default, removes the
                  violating tags you select below, and may reassign the category. The Pattern
                  Artifact, preview, and availability are unaffected. There is no separate appeal;
                  the owner may submit an ordinary Catalog Metadata Revision afterward.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="remediation-reason">Owner-visible reason</Label>
                  <Textarea
                    id="remediation-reason"
                    maxLength={2000}
                    placeholder="Explain what violated policy and what changed. Do not include reporter details."
                    value={remediationReason}
                    onChange={(event) => setRemediationReason(event.target.value)}
                  />
                </div>
                {review.pattern.tagCodes.length > 0 && (
                  <div className="space-y-2">
                    <Label>Tags to remove</Label>
                    <div className="flex flex-wrap gap-2 rounded-lg border border-input p-2">
                      {review.pattern.tagCodes.map((code) => {
                        const selected = removeTagCodes.includes(code);
                        const label =
                          tagsQuery.data?.find((tag) => tag.code === code)?.labels.find(
                            (entry) => entry.locale === 'en',
                          )?.label ?? code;
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() =>
                              setRemoveTagCodes((current) =>
                                selected
                                  ? current.filter((entry) => entry !== code)
                                  : [...current, code],
                              )
                            }
                          >
                            <Badge variant={selected ? 'destructive' : 'outline'} className="cursor-pointer">
                              {label}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Reassign category (optional)</Label>
                  <Select
                    value={remediationCategory ?? review.pattern.categoryCode}
                    onValueChange={(value) =>
                      setRemediationCategory(value === review.pattern.categoryCode ? null : value)
                    }
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categoriesQuery.data?.map((category) => (
                        <SelectItem key={category.code} value={category.code}>
                          {category.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <ConfirmActionDialog
                  trigger={
                    <Button disabled={remediationReason.trim().length === 0} variant="destructive">
                      Apply Catalog Metadata Remediation
                    </Button>
                  }
                  title="Apply Catalog Metadata Remediation?"
                  description="This immediately replaces the title and description with a safe default, removes the selected tags, may reassign the category, clears any active Review Hold, and resolves any pending Catalog Metadata Revision or appeal without publishing it. The owner receives one in-app notice and one idempotent email."
                  confirmLabel="Apply remediation"
                  destructive
                  onConfirm={async () => {
                    await remediate.mutateAsync({
                      categoryCode: remediationCategory ?? undefined,
                      reason: remediationReason.trim(),
                      removeTagCodes,
                    });
                    toast.success('Catalog Metadata Remediation applied and owner notice queued.');
                  }}
                />
                {remediate.error !== null && (
                  <p className="text-sm text-destructive">{remediate.error.message}</p>
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
