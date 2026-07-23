'use client';

import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useCatalogSubmissions } from '@/hooks/use-catalog-submissions';
import { ApiError } from '@/lib/client/fetcher';
import { formatDateTime } from '@/lib/format';
import type { CatalogSubmissionStatus } from '@/lib/types';

const STATUS_LABELS: Record<CatalogSubmissionStatus, string> = {
  accepted: 'Accepted', appeal_pending: 'Appeal pending', appeal_upheld: 'Appeal upheld',
  precheck_failed: 'Precheck failed', precheck_pending: 'Precheck pending', quarantined: 'Quarantined',
  rejected: 'Rejected', review_pending: 'Ready for review',
};

export function CatalogSubmissionsView() {
  const query = useCatalogSubmissions();
  return (
    <div>
      <PageHeader
        title="Catalog Review"
        description="Human review queue for immutable Community Pattern submissions and appeals."
      />
      <Card className="p-0">
        {query.isPending && <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div>}
        {query.isError && <div className="p-4"><ErrorState message={query.error instanceof ApiError ? query.error.message : 'Failed to load the review queue.'} onRetry={() => void query.refetch()} /></div>}
        {query.data !== undefined && query.data.length === 0 && <div className="p-4"><EmptyState title="Review queue is clear" message="New submissions and appeals will appear here after automated prechecks." /></div>}
        {query.data !== undefined && query.data.length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>Submission</TableHead><TableHead>Status</TableHead><TableHead>Validation</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
            <TableBody>
              {query.data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell><Link className="font-medium hover:underline" href={`/submissions/${item.id}`}>{item.title}</Link><div className="text-xs text-muted-foreground">{item.categoryCode} · {item.width} × {item.height}</div></TableCell>
                  <TableCell><Badge variant={item.status === 'quarantined' ? 'destructive' : 'secondary'}>{STATUS_LABELS[item.status]}</Badge></TableCell>
                  <TableCell><ValidationLabel metadata={item.metadataValid} technical={item.technicalValid} /></TableCell>
                  <TableCell>{formatDateTime(item.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function ValidationLabel({ metadata, technical }: { metadata: boolean | null; technical: boolean | null }) {
  if (metadata === false || technical === false) return <span className="text-sm font-medium text-destructive">Failed</span>;
  if (metadata === true && technical === true) return <span className="text-sm font-medium text-emerald-700">Passed</span>;
  return <span className="text-sm text-muted-foreground">Pending</span>;
}
