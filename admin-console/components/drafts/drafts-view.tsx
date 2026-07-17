'use client';

import { useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { PaginationBar } from '@/components/common/pagination-bar';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDrafts } from '@/hooks/use-drafts';
import { ApiError } from '@/lib/client/fetcher';
import type { OfficialPatternDraftStatus } from '@/lib/types';

import { DraftListItem } from './draft-list-item';
import { DraftStatusTabs } from './draft-status-tabs';
import { DraftUploadForm } from './draft-upload-form';

const PAGE_SIZE = 10;

export function DraftsView() {
  const [status, setStatus] = useState<'all' | OfficialPatternDraftStatus>('all');
  const [page, setPage] = useState(1);

  const draftsQuery = useDrafts({
    page,
    pageSize: PAGE_SIZE,
    status: status === 'all' ? undefined : status,
  });

  function handleStatusChange(next: 'all' | OfficialPatternDraftStatus): void {
    setStatus(next);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Drafts"
        description="Upload a source image, review its conversion, and publish it as an Official Pattern."
      />

      <DraftUploadForm />

      <div>
        <div className="mb-4">
          <DraftStatusTabs value={status} onValueChange={handleStatusChange} />
        </div>

        <Card className="p-0">
          {draftsQuery.isPending && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          )}

          {draftsQuery.isError && (
            <div className="p-4">
              <ErrorState
                message={
                  draftsQuery.error instanceof ApiError
                    ? draftsQuery.error.message
                    : 'Failed to load Official Pattern Drafts.'
                }
                onRetry={() => void draftsQuery.refetch()}
              />
            </div>
          )}

          {draftsQuery.data !== undefined && draftsQuery.data.items.length === 0 && (
            <div className="p-4">
              <EmptyState
                title="No drafts found"
                message="Upload a source image above to create your first Official Pattern Draft."
              />
            </div>
          )}

          {draftsQuery.data !== undefined && draftsQuery.data.items.length > 0 && (
            <>
              <div>
                {draftsQuery.data.items.map((draft) => (
                  <DraftListItem key={draft.id} draft={draft} />
                ))}
              </div>
              <PaginationBar
                page={draftsQuery.data.page}
                pageSize={draftsQuery.data.pageSize}
                total={draftsQuery.data.total}
                onPageChange={setPage}
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
