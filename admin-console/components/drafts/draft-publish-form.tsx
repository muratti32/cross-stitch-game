'use client';

import { useState } from 'react';
import Link from 'next/link';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
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
import { Switch } from '@/components/ui/switch';
import { TagPicker } from '@/components/common/tag-picker';
import { usePublishDraft } from '@/hooks/use-drafts';
import { ApiError } from '@/lib/client/fetcher';
import { deriveUnlockPriceTierHint, PRICE_TIER_UNIT_LABELS } from '@/lib/price-tier';
import type { Category, OfficialPatternDraftView, Tag } from '@/lib/types';

const MAX_TAG_CODES = 5;
const DEFAULT_CREATOR_NAME = 'Stitch Wish Team';

const publishSchema = z.object({
  categoryCode: z.string().min(1, 'Category is required'),
  creatorName: z.string().min(1, 'Creator name is required').max(255),
  paid: z.boolean(),
  tagCodes: z.array(z.string()).max(MAX_TAG_CODES, `Choose at most ${MAX_TAG_CODES} tags`),
  title: z.string().min(1, 'Title is required').max(255),
});
type PublishValues = z.infer<typeof publishSchema>;

export function DraftPublishForm({
  draft,
  categories,
  tags,
}: {
  draft: OfficialPatternDraftView;
  categories: Category[];
  tags: Tag[];
}) {
  const publishMutation = usePublishDraft(draft.id);
  const [publishedPatternId, setPublishedPatternId] = useState<string | null>(null);

  const form = useForm<PublishValues>({
    defaultValues: {
      categoryCode: '',
      creatorName: DEFAULT_CREATOR_NAME,
      paid: false,
      tagCodes: [],
      title: '',
    },
    resolver: zodResolver(publishSchema),
  });

  const paid = useWatch({ control: form.control, name: 'paid' });
  const tierHint = deriveUnlockPriceTierHint(paid, draft.stitchableCellCount);

  async function handleSubmit(values: PublishValues): Promise<void> {
    const response = await publishMutation.mutateAsync(values);
    setPublishedPatternId(response.patternId);
  }

  if (publishedPatternId !== null) {
    return (
      <Alert>
        <CheckCircle2 className="text-emerald-600" />
        <AlertDescription>
          Published. <Link href={`/patterns/${publishedPatternId}`} className="underline">View the Official Pattern</Link>.
        </AlertDescription>
      </Alert>
    );
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
                  .filter((category) => category.active)
                  .map((category) => (
                    <SelectItem key={category.code} value={category.code}>
                      {category.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        />
        {form.formState.errors.categoryCode !== undefined && (
          <p className="text-sm text-destructive">{form.formState.errors.categoryCode.message}</p>
        )}
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

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <p className="text-sm font-medium">Paid pattern</p>
          <p className="text-sm text-muted-foreground">
            {paid
              ? tierHint !== null
                ? `Pattern Unlock Price Tier: ${PRICE_TIER_UNIT_LABELS[tierHint]}, derived from ${draft.stitchableCellCount ?? 0} stitchable cells.`
                : 'Price tier will be derived from the stitchable-cell count.'
              : 'Free to unlock in the catalog.'}
          </p>
        </div>
        <Controller
          control={form.control}
          name="paid"
          render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />}
        />
      </div>

      {publishMutation.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {publishMutation.error instanceof ApiError
              ? publishMutation.error.message
              : 'Failed to publish this draft.'}
          </AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={publishMutation.isPending}>
        {publishMutation.isPending ? 'Publishing…' : 'Publish Official Pattern'}
      </Button>
    </form>
  );
}
