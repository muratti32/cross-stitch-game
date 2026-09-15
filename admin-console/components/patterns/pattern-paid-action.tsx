'use client';

import { toast } from 'sonner';

import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { Button } from '@/components/ui/button';
import { useSetPatternPaid } from '@/hooks/use-patterns';
import { PRICE_TIER_UNIT_LABELS } from '@/lib/price-tier';
import type { AdminPatternDetail } from '@/lib/types';

import { getPatternPaidIneligibility, patternPaidErrorMessage } from './pattern-paid-policy';

export function PatternPaidAction({ pattern }: { pattern: AdminPatternDetail }) {
  const mutation = useSetPatternPaid(pattern.id);
  const makePaid = pattern.unlockPriceTier === null;
  const reason = getPatternPaidIneligibility(pattern);
  const label = makePaid ? 'Make paid' : 'Make free';
  const reasonId = `pattern-paid-reason-${pattern.id}`;

  return (
    <div className="flex items-center gap-2">
      <ConfirmActionDialog
        trigger={<Button variant="outline" disabled={reason !== null} aria-describedby={reason === null ? undefined : reasonId}>{label}</Button>}
        title={`${label} this Official Pattern?`}
        description={makePaid ? (
          <span>
            The backend derives the price from stitchable-cell count: Small (75), Medium (150), or
            Large (300) Stitch Coins. Every player or guest who started this Pattern receives a free
            Grandfathered Pattern Unlock. Patterns without a recorded stitchable-cell count cannot be paid.
          </span>
        ) : (
          <span>Existing Pattern Unlocks are kept. No Stitch Coin is refunded.</span>
        )}
        confirmLabel={label}
        onConfirm={async () => {
          try {
            const result = await mutation.mutateAsync(makePaid);
            if (!result.changed) toast.success(`No change — already ${makePaid ? 'paid' : 'free'}.`);
            else if (result.afterTier === null) toast.success('Pattern is now free.');
            else toast.success(
              `Pattern is now paid: ${PRICE_TIER_UNIT_LABELS[result.afterTier]}. ${result.grandfatheredCount} players or guests grandfathered.`,
            );
          } catch (error) {
            throw new Error(patternPaidErrorMessage(error));
          }
        }}
      />
      {reason !== null && <span id={reasonId} className="text-xs text-muted-foreground">{reason}</span>}
    </div>
  );
}
