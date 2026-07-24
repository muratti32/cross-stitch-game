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
import { useCatalogMetadataRevisions } from '@/hooks/use-catalog-metadata-revisions';
import { ApiError } from '@/lib/client/fetcher';
import { formatDateTime } from '@/lib/format';

export function CatalogMetadataRevisionsView() {
  const query = useCatalogMetadataRevisions();
  return (
    <div>
      <PageHeader
        title="Metadata Revisions"
        description="Human review queue for Catalog Metadata Revisions on already-published Community Patterns."
      />
      <Card className="p-0">
        {query.isPending && <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div>}
        {query.isError && <div className="p-4"><ErrorState message={query.error instanceof ApiError ? query.error.message : 'Failed to load the review queue.'} onRetry={() => void query.refetch()} /></div>}
        {query.data !== undefined && query.data.length === 0 && <div className="p-4"><EmptyState title="Review queue is clear" message="New metadata revisions submitted by creators will appear here." /></div>}
        {query.data !== undefined && query.data.length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>Revision</TableHead><TableHead>Status</TableHead><TableHead>Metadata</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
            <TableBody>
              {query.data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell><Link className="font-medium hover:underline" href={`/metadata-revisions/${item.id}`}>{item.title}</Link><div className="text-xs text-muted-foreground">{item.categoryCode}</div></TableCell>
                  <TableCell><Badge variant={item.status === 'appeal_pending' ? 'destructive' : 'secondary'}>{item.status.replaceAll('_', ' ')}</Badge></TableCell>
                  <TableCell><ValidationLabel metadataValid={item.metadataValid} /></TableCell>
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

function ValidationLabel({ metadataValid }: { metadataValid: boolean | null }) {
  if (metadataValid === false) return <span className="text-sm font-medium text-destructive">Failed</span>;
  if (metadataValid === true) return <span className="text-sm font-medium text-emerald-700">Passed</span>;
  return <span className="text-sm text-muted-foreground">Pending</span>;
}
