'use client';

import { Ban, Shapes } from 'lucide-react';
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
import { useCategories, useDeactivateCategory } from '@/hooks/use-categories';
import { ApiError } from '@/lib/client/fetcher';
import type { Category } from '@/lib/types';

import { CreateCategoryDialog } from './create-category-dialog';
import { EditCategoryLabelDialog } from './edit-category-label-dialog';

export function CategoriesView() {
  const categoriesQuery = useCategories();

  return (
    <div>
      <PageHeader
        title="Categories"
        description="The single required Catalog Category assigned to every Official Pattern. Referenced categories are deactivated, never deleted."
        actions={<CreateCategoryDialog />}
      />

      <Card className="p-0">
        {categoriesQuery.isPending && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        )}

        {categoriesQuery.isError && (
          <div className="p-4">
            <ErrorState
              message={
                categoriesQuery.error instanceof ApiError
                  ? categoriesQuery.error.message
                  : 'Failed to load categories.'
              }
              onRetry={() => void categoriesQuery.refetch()}
            />
          </div>
        )}

        {categoriesQuery.data !== undefined && categoriesQuery.data.length === 0 && (
          <div className="p-4">
            <EmptyState
              icon={Shapes}
              title="No categories yet"
              message="Create a Catalog Category to classify Official Patterns."
            />
          </div>
        )}

        {categoriesQuery.data !== undefined && categoriesQuery.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoriesQuery.data.map((category) => (
                <CategoryRow key={category.code} category={category} />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const deactivateMutation = useDeactivateCategory(category.code);

  async function handleDeactivate(): Promise<void> {
    await deactivateMutation.mutateAsync();
    toast.success(`Category "${category.code}" deactivated.`);
  }

  return (
    <TableRow className={category.active ? undefined : 'text-muted-foreground'}>
      <TableCell className="font-mono text-xs">{category.code}</TableCell>
      <TableCell>{category.label}</TableCell>
      <TableCell>
        <Badge variant={category.active ? 'secondary' : 'outline'}>
          {category.active ? 'Active' : 'Inactive'}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <EditCategoryLabelDialog category={category} />
          {category.active && (
            <ConfirmActionDialog
              trigger={
                <Button variant="ghost" size="sm" className="text-destructive">
                  <Ban className="size-4" />
                  Deactivate
                </Button>
              }
              title={`Deactivate "${category.code}"?`}
              description="The category disappears from player-facing navigation and pickers but stays attached to patterns that already reference it. This cannot be undone from the console."
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
