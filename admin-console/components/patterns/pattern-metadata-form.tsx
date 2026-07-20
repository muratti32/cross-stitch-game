'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TagPicker } from '@/components/common/tag-picker';
import { useUpdatePatternMetadata } from '@/hooks/use-patterns';
import { ApiError } from '@/lib/client/fetcher';
import type { AdminPatternDetail, Category, Tag } from '@/lib/types';

const MAX_TAG_CODES = 5;

const metadataSchema = z.object({
  categoryCode: z.string().min(1, 'Category is required'),
  creatorName: z.string().min(1, 'Creator name is required').max(255),
  tagCodes: z.array(z.string()).max(MAX_TAG_CODES, `Choose at most ${MAX_TAG_CODES} tags`),
  title: z.string().min(1, 'Title is required').max(255),
});
type MetadataValues = z.infer<typeof metadataSchema>;

export function PatternMetadataForm({
  pattern,
  categories,
  tags,
}: {
  pattern: AdminPatternDetail;
  categories: Category[];
  tags: Tag[];
}) {
  const updateMutation = useUpdatePatternMetadata(pattern.id);

  const form = useForm<MetadataValues>({
    defaultValues: {
      categoryCode: pattern.categoryCode,
      creatorName: pattern.creatorName,
      tagCodes: pattern.tags.map((tag) => tag.code),
      title: pattern.title,
    },
    resolver: zodResolver(metadataSchema),
  });

  async function handleSubmit(values: MetadataValues): Promise<void> {
    try {
      await updateMutation.mutateAsync(values);
      toast.success('Pattern metadata updated.');
      form.reset(values);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update pattern metadata.');
    }
  }

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" {...form.register('title')} />
        {form.formState.errors.title !== undefined && (
          <p className="text-sm text-destructive">{form.formState.errors.title.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="creatorName">Creator name</Label>
        <Input id="creatorName" {...form.register('creatorName')} />
        {form.formState.errors.creatorName !== undefined && (
          <p className="text-sm text-destructive">{form.formState.errors.creatorName.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="categoryCode">Category</Label>
        <Controller
          control={form.control}
          name="categoryCode"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="categoryCode" className="w-full">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories
                  .filter((category) => category.active || category.code === pattern.categoryCode)
                  .map((category) => (
                    <SelectItem key={category.code} value={category.code}>
                      {category.label}
                      {!category.active && ' (inactive)'}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Catalog Tags</Label>
        <Controller
          control={form.control}
          name="tagCodes"
          render={({ field }) => (
            <TagPicker tags={tags} value={field.value} onChange={field.onChange} max={MAX_TAG_CODES} />
          )}
        />
        {form.formState.errors.tagCodes !== undefined && (
          <p className="text-sm text-destructive">{form.formState.errors.tagCodes.message}</p>
        )}
      </div>

      {updateMutation.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {updateMutation.error instanceof ApiError
              ? updateMutation.error.message
              : 'Failed to update pattern metadata.'}
          </AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={!form.formState.isDirty || updateMutation.isPending}>
        {updateMutation.isPending ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}
