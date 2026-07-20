'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateCategoryLabel } from '@/hooks/use-categories';
import { ApiError } from '@/lib/client/fetcher';
import type { Category } from '@/lib/types';

// Mirrors backend UpdateCategoryLabelDto constraints.
const updateLabelSchema = z.object({
  label: z.string().min(1, 'Label is required').max(255),
});
type UpdateLabelValues = z.infer<typeof updateLabelSchema>;

export function EditCategoryLabelDialog({ category }: { category: Category }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateCategoryLabel(category.code);

  const form = useForm<UpdateLabelValues>({
    defaultValues: { label: category.label },
    resolver: zodResolver(updateLabelSchema),
  });

  async function handleSubmit(values: UpdateLabelValues): Promise<void> {
    try {
      await updateMutation.mutateAsync(values.label);
      toast.success(`Label for "${category.code}" updated.`);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update category label.');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (updateMutation.isPending) {
          return;
        }
        setOpen(next);
        if (next) {
          form.reset({ label: category.label });
          updateMutation.reset();
        }
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Pencil className="size-4" />
        Edit label
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit label for “{category.code}”</DialogTitle>
          <DialogDescription>The code is permanent; only the display label can change.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="space-y-1.5">
            <Label htmlFor="category-label">Label</Label>
            <Input id="category-label" {...form.register('label')} />
            {form.formState.errors.label !== undefined && (
              <p className="text-sm text-destructive">{form.formState.errors.label.message}</p>
            )}
          </div>

          {updateMutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {updateMutation.error instanceof ApiError
                  ? updateMutation.error.message
                  : 'Failed to update category label.'}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving…' : 'Save label'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
