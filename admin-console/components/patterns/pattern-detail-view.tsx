'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { PatternStatusBadge } from '@/components/common/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategories } from '@/hooks/use-categories';
import { usePattern } from '@/hooks/use-patterns';
import { useTags } from '@/hooks/use-tags';
import { ApiError } from '@/lib/client/fetcher';
import { formatDate } from '@/lib/format';
import { PRICE_TIER_UNIT_LABELS } from '@/lib/price-tier';
import { toConsolePreviewSrc } from '@/lib/preview-url';

import { PatternMetadataForm } from './pattern-metadata-form';
import { PatternStatusActions } from './pattern-status-actions';

export function PatternDetailView({ patternId }: { patternId: string }) {
  const patternQuery = usePattern(patternId);
  const categoriesQuery = useCategories();
  const tagsQuery = useTags();

  return (
    <div>
      <Link
        href="/patterns"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Patterns
      </Link>

      {patternQuery.isPending && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <Skeleton className="aspect-square w-full" />
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      )}

      {patternQuery.isError && (
        <ErrorState
          message={
            patternQuery.error instanceof ApiError
              ? patternQuery.error.message
              : 'Failed to load this pattern.'
          }
          onRetry={() => void patternQuery.refetch()}
        />
      )}

      {patternQuery.data !== undefined && (
        <>
          <PageHeader
            title={patternQuery.data.title}
            description={`by ${patternQuery.data.creatorName}`}
            actions={<PatternStatusActions pattern={patternQuery.data} />}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
            <div className="space-y-4">
              <Image
                src={toConsolePreviewSrc(patternQuery.data.previewUrl)}
                alt={patternQuery.data.title}
                width={320}
                height={320}
                unoptimized
                className="w-full rounded-lg border border-border object-cover"
              />
              <Card>
                <CardContent className="space-y-2 pt-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <PatternStatusBadge status={patternQuery.data.status} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Size</span>
                    <span>
                      {patternQuery.data.width} × {patternQuery.data.height} cells
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Palette size</span>
                    <span>{patternQuery.data.paletteSize} colors</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Price</span>
                    <span>
                      {patternQuery.data.unlockPriceTier === null
                        ? 'Free'
                        : PRICE_TIER_UNIT_LABELS[patternQuery.data.unlockPriceTier]}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Published</span>
                    <span>{formatDate(patternQuery.data.publishedAt)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Metadata</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {categoriesQuery.isPending || tagsQuery.isPending ? (
                  <div className="space-y-3">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : categoriesQuery.isError || tagsQuery.isError ? (
                  <ErrorState message="Failed to load categories or tags for editing." />
                ) : (
                  <PatternMetadataForm
                    pattern={patternQuery.data}
                    categories={categoriesQuery.data ?? []}
                    tags={tagsQuery.data ?? []}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
