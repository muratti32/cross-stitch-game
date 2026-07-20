'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePatterns } from '@/hooks/use-patterns';
import { ApiError } from '@/lib/client/fetcher';
import { toConsolePreviewSrc } from '@/lib/preview-url';
import type { StaffPickItem } from '@/lib/types';

const RESULT_PAGE_SIZE = 10;

export function AddStaffPickDialog({
  pickedIds,
  onAdd,
}: {
  pickedIds: string[];
  onAdd: (pick: StaffPickItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 400);

  const patternsQuery = usePatterns({
    page: 1,
    pageSize: RESULT_PAGE_SIZE,
    search: search.length > 0 ? search : undefined,
    status: 'available',
  });

  const candidates = (patternsQuery.data?.items ?? []).filter(
    (pattern) => !pickedIds.includes(pattern.id),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSearchInput('');
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <Plus className="size-4" />
        Add pattern
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a Staff Pick</DialogTitle>
          <DialogDescription>
            Only available catalog Patterns can be featured. The pick is appended to the end of the
            list; save the order to apply it.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search title or creator…"
            className="pl-8"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
          {patternsQuery.isPending && (
            <div className="space-y-2 p-3">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          )}

          {patternsQuery.isError && (
            <p className="p-3 text-sm text-destructive">
              {patternsQuery.error instanceof ApiError
                ? patternsQuery.error.message
                : 'Failed to load patterns.'}
            </p>
          )}

          {patternsQuery.data !== undefined && candidates.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              No available patterns match — already featured patterns are hidden.
            </p>
          )}

          {candidates.map((pattern) => (
            <div
              key={pattern.id}
              className="flex items-center gap-3 border-b border-border p-3 last:border-b-0"
            >
              <Image
                src={toConsolePreviewSrc(pattern.previewUrl)}
                alt={pattern.title}
                width={40}
                height={40}
                unoptimized
                className="size-10 shrink-0 rounded-md border border-border object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{pattern.title}</p>
                <p className="truncate text-xs text-muted-foreground">{pattern.creatorName}</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  onAdd({
                    creatorName: pattern.creatorName,
                    patternId: pattern.id,
                    position: pickedIds.length + 1,
                    previewUrl: pattern.previewUrl,
                    title: pattern.title,
                  })
                }
              >
                Add
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
