'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { PaginationBar } from '@/components/common/pagination-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategories } from '@/hooks/use-categories';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePatterns } from '@/hooks/use-patterns';
import { ApiError } from '@/lib/client/fetcher';
import type { PatternStatus } from '@/lib/types';

import { BulkRemoveDialog } from './bulk-remove-dialog';

import { PatternStatusTabs } from './pattern-status-tabs';
import { PatternsTable } from './patterns-table';

const PAGE_SIZE = 20;

export function PatternsView() {
  const [status, setStatus] = useState<'all' | PatternStatus>('all');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const search = useDebouncedValue(searchInput, 400);

  const categoriesQuery = useCategories();
  const categoriesByCode = useMemo(
    () => new Map((categoriesQuery.data ?? []).map((category) => [category.code, category])),
    [categoriesQuery.data],
  );

  const patternsQuery = usePatterns({
    page,
    pageSize: PAGE_SIZE,
    search: search.length > 0 ? search : undefined,
    status: status === 'all' ? undefined : status,
  });

  function handleStatusChange(next: 'all' | PatternStatus): void {
    setSelectedIds(new Set());
    setStatus(next);
    setPage(1);
  }

  function handleSearchChange(next: string): void {
    setSelectedIds(new Set());
    setSearchInput(next);
    setPage(1);
  }

  function handlePageChange(next: number): void {
    setSelectedIds(new Set());
    setPage(next);
  }

  const selectedPatterns = (patternsQuery.data?.items ?? []).filter((pattern) =>
    selectedIds.has(pattern.id),
  );

  return (
    <div>
      <PageHeader
        title="Patterns"
        description="Official Patterns published to the catalog."
        actions={
          <Button render={<Link href="/drafts" />} nativeButton={false}>
            <Plus className="size-4" />
            Add pattern
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PatternStatusTabs value={status} onValueChange={handleStatusChange} />
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search title or creator…"
            className="pl-8"
            value={searchInput}
            onChange={(event) => handleSearchChange(event.target.value)}
          />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-md border p-3">
          <span className="text-sm">{selectedIds.size} selected</span>
          <Button variant="destructive" onClick={() => setBulkDialogOpen(true)}>
            <Trash2 className="size-4" /> Remove selected
          </Button>
        </div>
      )}

      <Card className="p-0">
        {patternsQuery.isPending && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        )}

        {patternsQuery.isError && (
          <div className="p-4">
            <ErrorState
              message={
                patternsQuery.error instanceof ApiError
                  ? patternsQuery.error.message
                  : 'Failed to load patterns.'
              }
              onRetry={() => void patternsQuery.refetch()}
            />
          </div>
        )}

        {patternsQuery.data !== undefined && patternsQuery.data.items.length === 0 && (
          <div className="p-4">
            <EmptyState
              title="No patterns found"
              message={
                search.length > 0 || status !== 'all'
                  ? 'Try a different search term or status filter.'
                  : 'Publish an Official Pattern Draft to see it here.'
              }
            />
          </div>
        )}

        {patternsQuery.data !== undefined && patternsQuery.data.items.length > 0 && (
          <>
            <PatternsTable
              items={patternsQuery.data.items}
              categoriesByCode={categoriesByCode}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
            />
            <PaginationBar
              page={patternsQuery.data.page}
              pageSize={patternsQuery.data.pageSize}
              total={patternsQuery.data.total}
              onPageChange={handlePageChange}
            />
          </>
        )}
      </Card>
      <BulkRemoveDialog
        patterns={selectedPatterns}
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        onSuccess={(result) => {
          const totalAfter = Math.max(
            0,
            (patternsQuery.data?.total ?? result.removedCount) - result.removedCount,
          );
          const lastPage = Math.max(1, Math.ceil(totalAfter / PAGE_SIZE));
          setPage(Math.min(page, lastPage));
          setSelectedIds(new Set());
          toast.success(`${result.removedCount} Patterns removed.`);
        }}
      />
    </div>
  );
}
