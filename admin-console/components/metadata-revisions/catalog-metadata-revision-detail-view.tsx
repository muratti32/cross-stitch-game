'use client';

import { useState } from 'react';
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
import {
  useAcceptCatalogMetadataRevision,
  useCatalogMetadataRevision,
  useRejectCatalogMetadataRevision,
} from '@/hooks/use-catalog-metadata-revisions';
import { ApiError } from '@/lib/client/fetcher';
import { formatDateTime } from '@/lib/format';
import type { CatalogRejectionReason } from '@/lib/types';

const REASONS: { label: string; value: CatalogRejectionReason }[] = [
  { label: 'Safety', value: 'safety' }, { label: 'Publication Rights', value: 'publication_rights' },
  { label: 'Duplicate or Spam', value: 'duplicate_or_spam' }, { label: 'Technical Invalidity', value: 'technical_invalidity' },
  { label: 'Quality Standard', value: 'quality_standard' },
];

export function CatalogMetadataRevisionDetailView({ revisionId }: { revisionId: string }) {
  const query = useCatalogMetadataRevision(revisionId);
  const accept = useAcceptCatalogMetadataRevision(revisionId);
  const reject = useRejectCatalogMetadataRevision(revisionId);
  const [reason, setReason] = useState<CatalogRejectionReason>('quality_standard');
  const [note, setNote] = useState('');

  if (query.isPending) return <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]"><Skeleton className="h-64" /><Skeleton className="h-96" /></div>;
  if (query.isError) return <ErrorState message={query.error instanceof ApiError ? query.error.message : 'Failed to load this revision.'} onRetry={() => void query.refetch()} />;
  const item = query.data;
  const reviewable = item.status === 'pending' || item.status === 'appeal_pending';
  const validationPassed = item.metadataValid !== false;
  const effectiveReason = validationPassed ? reason : 'technical_invalidity';

  const acceptRevision = async () => {
    try {
      await accept.mutateAsync({ note: note.trim() || undefined });
      toast.success('Revision accepted and published to the Community Pattern.');
    } catch {
      // The mutation error is rendered next to the decision controls.
    }
  };

  const rejectRevision = async () => {
    try {
      await reject.mutateAsync({ note: note.trim() || undefined, reason: effectiveReason });
      toast.success(item.status === 'appeal_pending' ? 'Appeal rejected.' : 'Revision rejected.');
    } catch {
      // The mutation error is rendered next to the decision controls.
    }
  };

  return (
    <div>
      <Link href="/metadata-revisions" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back to Metadata Revisions</Link>
      <PageHeader title={item.title} description={`Submitted ${formatDateTime(item.createdAt)}`} actions={<Badge variant={item.status === 'appeal_pending' ? 'destructive' : 'secondary'}>{item.status.replaceAll('_', ' ')}</Badge>} />
      {item.status === 'appeal_pending' && <Alert className="mb-6"><ShieldAlert /><AlertTitle>Appeal review</AlertTitle><AlertDescription>Assign a moderator other than {item.initialModeratorId ?? 'the initial reviewer'} when staffing allows.{item.appeal?.note ? ` Creator note: ${item.appeal.note}` : ''}</AlertDescription></Alert>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <Card><CardContent className="space-y-2 pt-4 text-sm"><Fact label="Language" value={item.sourceLanguage} /><Fact label="Category" value={item.categoryCode} /><Fact label="Tags" value={item.tagCodes.join(', ') || '—'} /><Fact label="Submitting account" value={item.accountId} /><Fact label="Creator profile" value={item.creatorProfileId} /><Fact label="Community Pattern" value={item.communityPatternId} /></CardContent></Card>
          {item.currentPattern !== null && (
            <Card><CardHeader><CardTitle>Currently published</CardTitle></CardHeader><CardContent className="space-y-2 pt-0 text-sm"><Fact label="Title" value={item.currentPattern.title} /><Fact label="Category" value={item.currentPattern.categoryCode} /><Fact label="Tags" value={item.currentPattern.tagCodes.join(', ') || '—'} /><Fact label="Published" value={formatDateTime(item.currentPattern.publishedAt)} /><p className="pt-2 text-xs leading-5 text-muted-foreground">{item.currentPattern.description}</p></CardContent></Card>
          )}
        </div>
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Proposed revision</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm leading-6">{item.description}</p></CardContent></Card>
          <Card><CardHeader><CardTitle>Precheck evidence</CardTitle></CardHeader><CardContent><Evidence label="Metadata safety subset" valid={item.metadataValid} errors={item.metadataErrors} /></CardContent></Card>
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
                    placeholder="Optional for acceptance; shown to the creator when rejected."
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
                      Stored evidence failed. Acceptance reruns the safety-subset validators and remains impossible until every invariant passes.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    disabled={accept.isPending || reject.isPending}
                    onClick={() => void acceptRevision()}
                  >
                    Accept and publish
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={accept.isPending || reject.isPending}
                    onClick={() => void rejectRevision()}
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
