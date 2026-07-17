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
import { useCreateTag } from '@/hooks/use-tags';
import { ApiError } from '@/lib/client/fetcher';

// Mirrors backend CreateTagDto / TagLabelInputDto constraints.
const createTagSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(64, 'At most 64 characters')
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, digits, and hyphens only'),
  labels: z
    .array(
      z.object({
        label: z.string().min(1, 'Label is required').max(255),
        locale: z.string().min(2, 'At least 2 characters').max(8, 'At most 8 characters'),
      }),
    )
    .min(1, 'At least one label is required'),
});
type CreateTagValues = z.infer<typeof createTagSchema>;

export function CreateTagDialog() {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateTag();

  const form = useForm<CreateTagValues>({
    defaultValues: { code: '', labels: [{ label: '', locale: 'en' }] },
    resolver: zodResolver(createTagSchema),
  });
  const labelsArray = useFieldArray({ control: form.control, name: 'labels' });

  async function handleSubmit(values: CreateTagValues): Promise<void> {
    try {
      await createMutation.mutateAsync(values);
      toast.success(`Tag "${values.code}" created.`);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to create tag.');
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
        New tag
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Catalog Tag</DialogTitle>
          <DialogDescription>
            The code is permanent and referenced by patterns; labels are shown to players per
            locale.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="space-y-1.5">
            <Label htmlFor="tag-code">Code</Label>
            <Input id="tag-code" placeholder="e.g. animals" {...form.register('code')} />
            {form.formState.errors.code !== undefined && (
              <p className="text-sm text-destructive">{form.formState.errors.code.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Labels</Label>
            <div className="space-y-2">
              {labelsArray.fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-2">
                  <div className="w-20">
                    <Input
                      placeholder="Locale"
                      aria-label="Locale"
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
                    disabled={labelsArray.fields.length === 1}
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
              onClick={() => labelsArray.append({ label: '', locale: '' })}
            >
              <Plus className="size-4" />
              Add locale
            </Button>
          </div>

          {createMutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {createMutation.error instanceof ApiError
                  ? createMutation.error.message
                  : 'Failed to create tag.'}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create tag'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
