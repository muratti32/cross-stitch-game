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
import { useUpdateTagLabels } from '@/hooks/use-tags';
import { ApiError } from '@/lib/client/fetcher';
import type { Tag } from '@/lib/types';

// Mirrors backend UpdateTagLabelsDto / TagLabelInputDto constraints. The
// backend upserts by locale and never deletes labels, so existing locales are
// shown read-only and only new locales can be appended.
const updateLabelsSchema = z.object({
  labels: z
    .array(
      z.object({
        existing: z.boolean(),
        label: z.string().min(1, 'Label is required').max(255),
        locale: z.string().min(2, 'At least 2 characters').max(8, 'At most 8 characters'),
      }),
    )
    .min(1, 'At least one label is required'),
});
type UpdateLabelsValues = z.infer<typeof updateLabelsSchema>;

export function EditTagLabelsDialog({ tag }: { tag: Tag }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateTagLabels(tag.code);

  const form = useForm<UpdateLabelsValues>({
    defaultValues: {
      labels: tag.labels.map((label) => ({ existing: true, ...label })),
    },
    resolver: zodResolver(updateLabelsSchema),
  });
  const labelsArray = useFieldArray({ control: form.control, name: 'labels' });

  async function handleSubmit(values: UpdateLabelsValues): Promise<void> {
    try {
      await updateMutation.mutateAsync(
        values.labels.map(({ label, locale }) => ({ label, locale })),
      );
      toast.success(`Labels for "${tag.code}" updated.`);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update tag labels.');
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
          form.reset({ labels: tag.labels.map((label) => ({ existing: true, ...label })) });
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
          <DialogTitle>Edit labels for “{tag.code}”</DialogTitle>
          <DialogDescription>
            Labels are upserted per locale; existing locales cannot be removed.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="space-y-1.5">
            <Label>Labels</Label>
            <div className="space-y-2">
              {labelsArray.fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-2">
                  <div className="w-20">
                    <Input
                      placeholder="Locale"
                      aria-label="Locale"
                      readOnly={field.existing}
                      className={field.existing ? 'bg-muted' : undefined}
                      {...form.register(`labels.${index}.locale`)}
                    />
                    {form.formState.errors.labels?.[index]?.locale !== undefined && (
                      <p className="mt-1 text-xs text-destructive">
                        {form.formState.errors.labels[index].locale.message}
                      </p>
                    )}
                  </div>
                  <div className="flex-1">
                    <Input
                      placeholder="Label"
                      aria-label="Label"
                      {...form.register(`labels.${index}.label`)}
                    />
                    {form.formState.errors.labels?.[index]?.label !== undefined && (
                      <p className="mt-1 text-xs text-destructive">
                        {form.formState.errors.labels[index].label.message}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={field.existing}
                    onClick={() => labelsArray.remove(index)}
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">Remove label</span>
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => labelsArray.append({ existing: false, label: '', locale: '' })}
            >
              <Plus className="size-4" />
              Add locale
            </Button>
          </div>

          {updateMutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {updateMutation.error instanceof ApiError
                  ? updateMutation.error.message
                  : 'Failed to update tag labels.'}
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
