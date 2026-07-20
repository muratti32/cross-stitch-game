'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
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
import { useCreateCategory } from '@/hooks/use-categories';
import { ApiError } from '@/lib/client/fetcher';

// Mirrors backend CreateCategoryDto constraints.
const createCategorySchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(64, 'At most 64 characters')
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, digits, and hyphens only'),
  label: z.string().min(1, 'Label is required').max(255),
});
type CreateCategoryValues = z.infer<typeof createCategorySchema>;

export function CreateCategoryDialog() {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateCategory();

  const form = useForm<CreateCategoryValues>({
    defaultValues: { code: '', label: '' },
    resolver: zodResolver(createCategorySchema),
  });

  async function handleSubmit(values: CreateCategoryValues): Promise<void> {
    try {
      await createMutation.mutateAsync(values);
      toast.success(`Category "${values.code}" created.`);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to create category.');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (createMutation.isPending) {
          return;
        }
        setOpen(next);
        if (!next) {
          form.reset();
          createMutation.reset();
        }
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus className="size-4" />
        New category
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Catalog Category</DialogTitle>
          <DialogDescription>
            The code is permanent and referenced by patterns; the label is shown to players.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="space-y-1.5">
            <Label htmlFor="category-code">Code</Label>
            <Input id="category-code" placeholder="e.g. animals" {...form.register('code')} />
            {form.formState.errors.code !== undefined && (
              <p className="text-sm text-destructive">{form.formState.errors.code.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category-label">Label</Label>
            <Input id="category-label" placeholder="e.g. Animals" {...form.register('label')} />
            {form.formState.errors.label !== undefined && (
              <p className="text-sm text-destructive">{form.formState.errors.label.message}</p>
            )}
          </div>

          {createMutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {createMutation.error instanceof ApiError
                  ? createMutation.error.message
                  : 'Failed to create category.'}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
