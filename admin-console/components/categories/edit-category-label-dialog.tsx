'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Trash2 } from 'lucide-react';
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
import { useUpdateCategoryLabels } from '@/hooks/use-categories';
import { ApiError } from '@/lib/client/fetcher';
import type { Category } from '@/lib/types';

// Mirrors backend UpdateCategoryLabelsDto constraints.
const updateLabelsSchema = z.object({
  labels: z.array(z.object({ existing: z.boolean(), label: z.string().min(1).max(255), locale: z.string().min(2).max(8) })).min(1).refine((labels) => labels.some((label) => label.locale === 'en'), 'English label is required'),
});
type UpdateLabelsValues = z.infer<typeof updateLabelsSchema>;

export function EditCategoryLabelDialog({ category }: { category: Category }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateCategoryLabels(category.code);

  const form = useForm<UpdateLabelsValues>({
    defaultValues: { labels: category.labels.map((label) => ({ existing: true, ...label })) },
    resolver: zodResolver(updateLabelsSchema),
  });
  const labelsArray = useFieldArray({ control: form.control, name: 'labels' });

  async function handleSubmit(values: UpdateLabelsValues): Promise<void> {
    try {
      await updateMutation.mutateAsync(values.labels.map(({ label, locale }) => ({ label, locale })));
      toast.success(`Labels for "${category.code}" updated.`);
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
          form.reset({ labels: category.labels.map((label) => ({ existing: true, ...label })) });
          updateMutation.reset();
        }
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Pencil className="size-4" />
        Edit labels
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit labels for “{category.code}”</DialogTitle>
          <DialogDescription>The code is permanent; English is required and labels are upserted per locale.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="space-y-1.5"><Label>Labels</Label><div className="space-y-2">{labelsArray.fields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-2">
              <Input className="w-20" aria-label="Locale" readOnly={field.existing} {...form.register(`labels.${index}.locale`)} />
              <Input className="flex-1" aria-label="Label" {...form.register(`labels.${index}.label`)} />
              <Button type="button" variant="ghost" size="icon-sm" disabled={field.existing} onClick={() => labelsArray.remove(index)}><Trash2 className="size-4" /></Button>
            </div>
          ))}</div><Button type="button" variant="outline" size="sm" onClick={() => labelsArray.append({ existing: false, label: '', locale: '' })}><Plus className="size-4" /> Add locale</Button></div>

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
              {updateMutation.isPending ? 'Saving…' : 'Save labels'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
