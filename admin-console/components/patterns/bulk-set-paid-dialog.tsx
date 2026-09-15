'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBulkSetPatternsPaid } from '@/hooks/use-patterns';
import { PRICE_TIER_UNIT_LABELS } from '@/lib/price-tier';
import type { AdminPatternListItem, BulkSetPatternsPaidResponse } from '@/lib/types';

import { formatBulkPaidSummary, getPatternPaidIneligibility, patternPaidErrorMessage } from './pattern-paid-policy';

export function BulkSetPaidDialog({ patterns, paid, open, onOpenChange, onSuccess }: {
  patterns: AdminPatternListItem[];
  paid: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (result: BulkSetPatternsPaidResponse) => void;
}) {
  const mutation = useBulkSetPatternsPaid();
  const [result, setResult] = useState<BulkSetPatternsPaidResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eligible = patterns.filter((pattern) => getPatternPaidIneligibility(pattern) === null);
  const skipped = patterns.length - eligible.length;
  const action = paid ? 'paid' : 'free';

  function close(): void {
    if (mutation.isPending) return;
    if (result !== null) onSuccess(result);
    setResult(null);
    setError(null);
    onOpenChange(false);
  }

  async function submit(): Promise<void> {
    setError(null);
    try {
      setResult(await mutation.mutateAsync({ patternIds: eligible.map((pattern) => pattern.id), paid }));
    } catch (caught) {
      setError(patternPaidErrorMessage(caught));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="sm:max-w-2xl" showCloseButton={!mutation.isPending}>
        <DialogHeader>
          <DialogTitle>{result === null ? `Make ${eligible.length} Official ${eligible.length === 1 ? 'Pattern' : 'Patterns'} ${action}?` : 'Paid change results'}</DialogTitle>
          <DialogDescription>
            {paid
              ? 'Prices are derived from stitchable-cell count: Small (75), Medium (150), or Large (300). Every player or guest who started this Pattern receives a free Grandfathered Pattern Unlock.'
              : 'Existing Pattern Unlocks are kept and no Stitch Coin is refunded.'}
            {skipped > 0 && ` ${skipped} ineligible selected Patterns will be skipped.`}
          </DialogDescription>
        </DialogHeader>
        {result === null ? (
          <ul className="max-h-52 overflow-y-auto rounded-md border p-3 text-sm">
            {eligible.map((pattern) => <li key={pattern.id}>{pattern.title}</li>)}
          </ul>
        ) : (
          <div className="space-y-2">
            <p className="font-medium">{formatBulkPaidSummary(result)}</p>
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-3 text-sm">
              {[...result.results].sort((left, right) => {
                const leftTitle = patterns.find((pattern) => pattern.id === left.patternId)?.title ?? left.patternId;
                const rightTitle = patterns.find((pattern) => pattern.id === right.patternId)?.title ?? right.patternId;
                return leftTitle.localeCompare(rightTitle);
              }).map((item) => {
                const title = patterns.find((pattern) => pattern.id === item.patternId)?.title ?? item.patternId;
                if (item.outcome === 'failed') return <li key={item.patternId}>{title}: Failed — {patternPaidErrorMessage(item.errorCode)}</li>;
                const tier = item.afterTier === null ? 'Free' : PRICE_TIER_UNIT_LABELS[item.afterTier];
                const grandfathered = item.outcome === 'changed' && item.afterTier !== null
                  ? `; ${item.grandfatheredCount} players or guests grandfathered`
                  : '';
                return <li key={item.patternId}>{title}: {item.outcome === 'changed' ? 'Changed' : 'Unchanged'} — {tier}{grandfathered}</li>;
              })}
            </ul>
          </div>
        )}
        {error !== null && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          {result !== null ? (
            <Button onClick={close}>Close</Button>
          ) : (
            <>
              <Button variant="outline" disabled={mutation.isPending} onClick={close}>Cancel</Button>
              <Button disabled={eligible.length === 0 || mutation.isPending} onClick={() => void submit()}>
                {mutation.isPending ? 'Working…' : `Make ${action}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
