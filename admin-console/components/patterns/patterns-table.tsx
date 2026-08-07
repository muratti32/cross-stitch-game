'use client';

import Image from 'next/image';
import Link from 'next/link';

import { PatternStatusBadge } from '@/components/common/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { PRICE_TIER_UNIT_LABELS } from '@/lib/price-tier';
import { toConsolePreviewSrc } from '@/lib/preview-url';
import type { AdminPatternListItem, Category } from '@/lib/types';
import { eligiblePatternIds, getBulkRemovalIneligibility } from './bulk-remove-policy';

export function PatternsTable({
  items,
  categoriesByCode,
  selectedIds,
  onSelectionChange,
}: {
  items: AdminPatternListItem[];
  categoriesByCode: Map<string, Category>;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}) {
  const eligibleIds = eligiblePatternIds(items);
  const allEligibleSelected =
    eligibleIds.length > 0 && eligibleIds.every((id) => selectedIds.has(id));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label="Select all eligible Official Patterns on this page"
              checked={allEligibleSelected}
              disabled={eligibleIds.length === 0}
              onCheckedChange={(checked) =>
                onSelectionChange(checked ? new Set(eligibleIds) : new Set())
              }
            />
          </TableHead>
          <TableHead className="w-16">Preview</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Creator</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Price</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Published</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((pattern) => (
          <TableRow key={pattern.id} className="cursor-pointer">
            <TableCell title={getBulkRemovalIneligibility(pattern) ?? undefined}>
              <Checkbox
                aria-label={`Select ${pattern.title}`}
                checked={selectedIds.has(pattern.id)}
                disabled={getBulkRemovalIneligibility(pattern) !== null}
                onCheckedChange={(checked) => {
                  const next = new Set(selectedIds);
                  if (checked) {
                    next.add(pattern.id);
                  } else {
                    next.delete(pattern.id);
                  }
                  onSelectionChange(next);
                }}
              />
              {getBulkRemovalIneligibility(pattern) !== null && (
                <span className="sr-only">{getBulkRemovalIneligibility(pattern)}</span>
              )}
            </TableCell>
            <TableCell>
              <Link href={`/patterns/${pattern.id}`}>
                <Image
                  src={toConsolePreviewSrc(pattern.previewUrl)}
                  alt={pattern.title}
                  width={40}
                  height={40}
                  unoptimized
                  className="size-10 rounded-md border border-border object-cover"
                />
              </Link>
            </TableCell>
            <TableCell className="max-w-56 truncate whitespace-normal font-medium">
              <Link href={`/patterns/${pattern.id}`} className="hover:underline">
                {pattern.title}
              </Link>
            </TableCell>
            <TableCell>{pattern.creatorName}</TableCell>
            <TableCell className="capitalize">{pattern.patternType}</TableCell>
            <TableCell>{categoriesByCode.get(pattern.categoryCode)?.label ?? pattern.categoryCode}</TableCell>
            <TableCell>
              {pattern.unlockPriceTier === null ? 'Free' : PRICE_TIER_UNIT_LABELS[pattern.unlockPriceTier]}
            </TableCell>
            <TableCell>
              <PatternStatusBadge status={pattern.status} />
            </TableCell>
            <TableCell>{formatDate(pattern.publishedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
