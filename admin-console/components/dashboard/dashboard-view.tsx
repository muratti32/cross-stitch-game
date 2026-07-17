'use client';

import Link from 'next/link';
import { Images, Star, Tags, UploadCloud } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboardCounts } from '@/hooks/use-dashboard-counts';
import { ApiError } from '@/lib/client/fetcher';
import type { OfficialPatternDraftStatus, PatternStatus } from '@/lib/types';

const PATTERN_STATUS_LABELS: Record<PatternStatus, string> = {
  available: 'Available',
  removed: 'Removed',
  withdrawn: 'Withdrawn',
};

const DRAFT_STATUS_LABELS: Record<OfficialPatternDraftStatus, string> = {
  discarded: 'Discarded',
  failed: 'Failed',
  pending: 'Pending',
  processing: 'Processing',
  published: 'Published',
  ready: 'Ready',
};

const QUICK_LINKS = [
  { description: 'Review and manage the catalog', href: '/patterns', icon: Images, label: 'Patterns' },
  { description: 'Upload and publish new patterns', href: '/drafts', icon: UploadCloud, label: 'Drafts' },
  { description: 'Curate the featured lineup', href: '/staff-picks', icon: Star, label: 'Staff Picks' },
  { description: 'Manage Catalog Tags', href: '/tags', icon: Tags, label: 'Tags' },
] as const;

export function DashboardView() {
  const { data, error, isError, refetch } = useDashboardCounts();

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="A snapshot of the Pattern Catalog and Official Pattern Drafts."
      />

      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Failed to load dashboard counts.'}
          onRetry={() => void refetch()}
        />
      )}

      {!isError && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Patterns by status</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              {(Object.keys(PATTERN_STATUS_LABELS) as PatternStatus[]).map((status) => (
                <div key={status} className="rounded-lg border border-border p-3 text-center">
                  {data === undefined ? (
                    <Skeleton className="mx-auto h-8 w-12" />
                  ) : (
                    <p className="text-2xl font-semibold">{data.patterns[status]}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">{PATTERN_STATUS_LABELS[status]}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Official Pattern Drafts by status</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              {(Object.keys(DRAFT_STATUS_LABELS) as OfficialPatternDraftStatus[]).map((status) => (
                <div key={status} className="rounded-lg border border-border p-3 text-center">
                  {data === undefined ? (
                    <Skeleton className="mx-auto h-8 w-12" />
                  ) : (
                    <p className="text-2xl font-semibold">{data.drafts[status]}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">{DRAFT_STATUS_LABELS[status]}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href}>
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardContent className="flex items-start gap-3 pt-4">
                  <Icon className="size-5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{link.label}</p>
                    <p className="text-sm text-muted-foreground">{link.description}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
