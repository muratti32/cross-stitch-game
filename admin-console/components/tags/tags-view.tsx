'use client';

import { Ban, Tags } from 'lucide-react';
import { toast } from 'sonner';

import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useDeactivateTag, useTags } from '@/hooks/use-tags';
import { ApiError } from '@/lib/client/fetcher';
import type { Tag } from '@/lib/types';

import { CreateTagDialog } from './create-tag-dialog';
import { EditTagLabelsDialog } from './edit-tag-labels-dialog';

export function TagsView() {
  const tagsQuery = useTags();

  return (
    <div>
      <PageHeader
        title="Tags"
        description="Catalog Tags attached to Official Patterns. Referenced tags are deactivated, never deleted."
        actions={<CreateTagDialog />}
      />

      <Card className="p-0">
        {tagsQuery.isPending && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        )}

        {tagsQuery.isError && (
          <div className="p-4">
            <ErrorState
              message={
                tagsQuery.error instanceof ApiError
                  ? tagsQuery.error.message
                  : 'Failed to load tags.'
              }
              onRetry={() => void tagsQuery.refetch()}
            />
          </div>
        )}

        {tagsQuery.data !== undefined && tagsQuery.data.length === 0 && (
          <div className="p-4">
            <EmptyState
              icon={Tags}
              title="No tags yet"
              message="Create a Catalog Tag to organize Official Patterns."
            />
          </div>
        )}

        {tagsQuery.data !== undefined && tagsQuery.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Labels</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tagsQuery.data.map((tag) => (
                <TagRow key={tag.code} tag={tag} />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function TagRow({ tag }: { tag: Tag }) {
  const deactivateMutation = useDeactivateTag(tag.code);

  async function handleDeactivate(): Promise<void> {
    await deactivateMutation.mutateAsync();
    toast.success(`Tag "${tag.code}" deactivated.`);
  }

  return (
    <TableRow className={tag.active ? undefined : 'text-muted-foreground'}>
      <TableCell className="font-mono text-xs">{tag.code}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1.5">
          {tag.labels.map((label) => (
            <Badge key={label.locale} variant="outline">
              <span className="text-muted-foreground">{label.locale}:</span> {label.label}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={tag.active ? 'secondary' : 'outline'}>
          {tag.active ? 'Active' : 'Inactive'}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <EditTagLabelsDialog tag={tag} />
          {tag.active && (
            <ConfirmActionDialog
              trigger={
                <Button variant="ghost" size="sm" className="text-destructive">
                  <Ban className="size-4" />
                  Deactivate
                </Button>
              }
              title={`Deactivate "${tag.code}"?`}
              description="The tag disappears from player-facing filters and pickers but stays attached to patterns that already reference it. This cannot be undone from the console."
              confirmLabel="Deactivate"
              destructive
              onConfirm={handleDeactivate}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
