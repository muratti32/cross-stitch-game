'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAcceptCatalogSubmission, useCatalogSubmission, useRejectCatalogSubmission } from '@/hooks/use-catalog-submissions';
import { ApiError } from '@/lib/client/fetcher';
import { formatDateTime } from '@/lib/format';
import type { CatalogRejectionReason } from '@/lib/types';

const REASONS: { label: string; value: CatalogRejectionReason }[] = [
  { label: 'Safety', value: 'safety' }, { label: 'Publication Rights', value: 'publication_rights' },
  { label: 'Duplicate or Spam', value: 'duplicate_or_spam' }, { label: 'Technical Invalidity', value: 'technical_invalidity' },
  { label: 'Quality Standard', value: 'quality_standard' },
];

export function CatalogSubmissionDetailView({ submissionId }: { submissionId: string }) {
  const query = useCatalogSubmission(submissionId);
  const accept = useAcceptCatalogSubmission(submissionId);
  const reject = useRejectCatalogSubmission(submissionId);
  const [reason, setReason] = useState<CatalogRejectionReason>('quality_standard');
  const [note, setNote] = useState('');

  if (query.isPending) return <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]"><Skeleton className="aspect-square" /><Skeleton className="h-96" /></div>;
  if (query.isError) return <ErrorState message={query.error instanceof ApiError ? query.error.message : 'Failed to load this submission.'} onRetry={() => void query.refetch()} />;
  const item = query.data;
  const reviewable = item.status === 'review_pending' || item.status === 'quarantined' || item.status === 'appeal_pending';
  const validationPassed = item.metadataValid === true && item.technicalValid === true;
  const effectiveReason = validationPassed ? reason : 'technical_invalidity';

  const acceptSubmission = async () => {
    try {
      await accept.mutateAsync({ note: note.trim() || undefined });
      toast.success('Submission accepted and published.');
    } catch {
      // The mutation error is rendered next to the decision controls.
    }
  };

  const rejectSubmission = async () => {
    try {
      await reject.mutateAsync({ note: note.trim() || undefined, reason: effectiveReason });
      toast.success(item.status === 'appeal_pending' ? 'Appeal rejected.' : 'Submission rejected.');
    } catch {
      // The mutation error is rendered next to the decision controls.
    }
  };

  return (
    <div>
      <Link href="/submissions" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back to Catalog Review</Link>
      <PageHeader title={item.title} description={`Submitted ${formatDateTime(item.createdAt)}`} actions={<Badge variant={item.status === 'quarantined' ? 'destructive' : 'secondary'}>{item.status.replaceAll('_', ' ')}</Badge>} />
      {item.status === 'appeal_pending' && <Alert className="mb-6"><ShieldAlert /><AlertTitle>Appeal review</AlertTitle><AlertDescription>Assign a moderator other than {item.initialModeratorId ?? 'the initial reviewer'} when staffing allows.{item.appeal?.note ? ` Player note: ${item.appeal.note}` : ''}</AlertDescription></Alert>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <Image src={`/api/admin/catalog-submissions/${item.id}/preview`} alt={`Immutable preview of ${item.title}`} width={360} height={360} unoptimized className="aspect-square w-full rounded-lg border border-border object-contain" />
          <Card><CardContent className="space-y-2 pt-4 text-sm"><Fact label="Dimensions" value={`${item.width} × ${item.height} cells`} /><Fact label="Palette" value={`${item.paletteSize} colors`} /><Fact label="Language" value={item.sourceLanguage} /><Fact label="Category" value={item.categoryCode} /><Fact label="Tags" value={item.tagCodes.join(', ') || '—'} /><Fact label="Rights declaration" value={`${item.rightsDeclared ? 'Declared' : 'Missing'} · ${item.licenseVersion}`} /><Fact label="Declared at" value={formatDateTime(item.rightsDeclaredAt)} /><Fact label="Submitting account" value={item.accountId} /><Fact label="Creator profile" value={item.creatorProfileId} /></CardContent></Card>
        </div>
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Immutable submission snapshot</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm leading-6">{item.description}</p><p className="text-xs text-muted-foreground">Source Personal Pattern: {item.sourcePatternId}</p></CardContent></Card>
          <Card><CardHeader><CardTitle>Precheck evidence</CardTitle></CardHeader><CardContent className="space-y-4"><Evidence label="Metadata" valid={item.metadataValid} errors={item.metadataErrors} /><Evidence label="Technical artifact and preview" valid={item.technicalValid} errors={item.technicalErrors} /><JsonEvidence label="Safety moderation" value={item.moderationEvidence} /><JsonEvidence label="Perceptual similarity" value={item.similarityEvidence} /></CardContent></Card>
          {item.decisions.length > 0 && <Card><CardHeader><CardTitle>Decision history</CardTitle></CardHeader><CardContent className="space-y-3">{item.decisions.map((decision) => <div key={`${decision.reviewRound}-${decision.createdAt}`} className="rounded-lg border p-3 text-sm"><div className="font-medium capitalize">{decision.reviewRound} · {decision.decision}</div><div className="text-xs text-muted-foreground">{formatDateTime(decision.createdAt)} · {decision.operatorAccountId}</div>{decision.rejectionReason !== null && <div className="mt-2">{decision.rejectionReason.replaceAll('_', ' ')}</div>}{decision.note !== null && <p className="mt-1 text-muted-foreground">{decision.note}</p>}</div>)}</CardContent></Card>}
          {reviewable && (
            <Card>
              <CardHeader><CardTitle>Human decision</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="review-note">Moderator note</Label>
                  <Textarea
                    id="review-note"
                    maxLength={2000}
                    placeholder="Optional for acceptance; shown to the player when rejected."
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Rejection reason</Label>
                  <Select
                    value={effectiveReason}
                    onValueChange={(value) => setReason(value as CatalogRejectionReason)}
                    disabled={!validationPassed}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REASONS.map((entry) => (
                        <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!validationPassed && (
                    <p className="text-xs text-destructive">
                      Stored evidence failed. Acceptance reruns current validators and remains impossible until every invariant passes.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    disabled={accept.isPending || reject.isPending}
                    onClick={() => void acceptSubmission()}
                  >
                    Accept and publish
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={accept.isPending || reject.isPending}
                    onClick={() => void rejectSubmission()}
                  >
                    Reject
                  </Button>
                </div>
                {(accept.error !== null || reject.error !== null) && (
                  <p className="text-sm text-destructive">
                    {accept.error instanceof Error
                      ? accept.error.message
                      : reject.error instanceof Error
                        ? reject.error.message
                        : 'The review decision failed.'}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className="break-all text-right">{value}</span></div>; }
function Evidence({ errors, label, valid }: { errors: string[]; label: string; valid: boolean | null }) { return <div><div className="flex items-center justify-between"><span className="text-sm font-medium">{label}</span><Badge variant={valid === false ? 'destructive' : 'secondary'}>{valid === null ? 'Pending' : valid ? 'Passed' : 'Failed'}</Badge></div>{errors.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-destructive">{errors.map((entry) => <li key={entry}>{entry}</li>)}</ul>}</div>; }
function JsonEvidence({ label, value }: { label: string; value: unknown }) { return <div><div className="mb-2 text-sm font-medium">{label}</div><pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre></div>; }
