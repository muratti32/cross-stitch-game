'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useForm } from 'react-hook-form';
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
  labels: z.array(z.object({ label: z.string().min(1, 'Label is required').max(255), locale: z.string().min(2).max(8) })).min(1).refine((labels) => labels.some((label) => label.locale === 'en'), 'English label is required'),
});
type CreateCategoryValues = z.infer<typeof createCategorySchema>;

export function CreateCategoryDialog() {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateCategory();

  const form = useForm<CreateCategoryValues>({
    defaultValues: { code: '', labels: [{ label: '', locale: 'en' }] },
    resolver: zodResolver(createCategorySchema),
  });
  const labelsArray = useFieldArray({ control: form.control, name: 'labels' });

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
            The code is permanent and referenced by patterns; labels are shown per locale.
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
            <Label>Labels</Label>
            <div className="space-y-2">{labelsArray.fields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2">
                <Input className="w-20" placeholder="Locale" aria-label="Locale" {...form.register(`labels.${index}.locale`)} />
                <Input className="flex-1" placeholder="Label" aria-label="Label" {...form.register(`labels.${index}.label`)} />
                <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => labelsArray.remove(index)}><Trash2 className="size-4" /></Button>
              </div>
            ))}</div>
            <Button type="button" variant="outline" size="sm" onClick={() => labelsArray.append({ label: '', locale: '' })}><Plus className="size-4" /> Add locale</Button>
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
