'use client';

import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { PatternStatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePostPublicationReviews } from '@/hooks/use-post-publication-reviews';
import { ApiError } from '@/lib/client/fetcher';
import { formatDateTime } from '@/lib/format';

export function PostPublicationReviewsView() {
  const query = usePostPublicationReviews();

  return (
    <div>
      <PageHeader
        title="Post-Publication Reviews"
        description="Human review queue opened by Community Reports. Reports never change catalog availability without an explicit moderator decision."
      />
      <Card className="p-0">
        {query.isPending && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        )}
        {query.isError && (
          <div className="p-4">
            <ErrorState
              message={
                query.error instanceof ApiError
                  ? query.error.message
                  : 'Failed to load open Post-Publication Reviews.'
              }
              onRetry={() => void query.refetch()}
            />
          </div>
        )}
        {query.data !== undefined && query.data.length === 0 && (
          <div className="p-4">
            <EmptyState
              title="Review queue is clear"
              message="New Community Reports will open a review here without hiding the Pattern automatically."
            />
          </div>
        )}
        {query.data !== undefined && query.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Community Pattern</TableHead>
                <TableHead>Reports</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Opened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((review) => (
                <TableRow key={review.id}>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      href={`/post-publication-reviews/${review.id}`}
                    >
                      {review.patternTitle}
                    </Link>
                    <div className="text-xs text-muted-foreground">{review.patternId}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{review.reportCount}</Badge>
                  </TableCell>
                  <TableCell>
                    <PatternStatusBadge status={review.patternStatus} />
                  </TableCell>
                  <TableCell>{formatDateTime(review.openedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
