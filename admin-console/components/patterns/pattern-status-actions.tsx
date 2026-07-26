'use client';

import { toast } from 'sonner';

import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { Button } from '@/components/ui/button';
import { useRemovePattern, useRestorePattern, useWithdrawPattern } from '@/hooks/use-patterns';
import type { AdminPatternDetail } from '@/lib/types';

export function PatternStatusActions({ pattern }: { pattern: AdminPatternDetail }) {
  const withdrawMutation = useWithdrawPattern(pattern.id);
  const removeMutation = useRemovePattern(pattern.id);
  const restoreMutation = useRestorePattern(pattern.id);
  const heldForReview = pattern.status === 'review_hold';

  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmActionDialog
        trigger={
          <Button variant="outline" disabled={heldForReview || pattern.status === 'withdrawn'}>
            Withdraw
          </Button>
        }
        title="Withdraw this Official Pattern?"
        description="Withdrawing hides it from the Pattern Catalog immediately and prevents new stitching sessions from starting. Players who already unlocked it keep their progress. You can restore it later."
        confirmLabel="Withdraw"
        onConfirm={async () => {
          await withdrawMutation.mutateAsync();
          toast.success('Pattern withdrawn.');
        }}
      />
      <ConfirmActionDialog
        trigger={
          <Button variant="destructive" disabled={heldForReview || pattern.status === 'removed'}>
            Remove
          </Button>
        }
        title="Remove this Official Pattern?"
        description="Removing applies Safety Removal semantics: the Pattern is hidden from the catalog and treated as unsafe or inappropriate content. Use this only when the content must not remain visible. You can restore it later if this was done in error."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          await removeMutation.mutateAsync();
          toast.success('Pattern removed.');
        }}
      />
      <ConfirmActionDialog
        trigger={
          <Button variant="secondary" disabled={heldForReview || pattern.status === 'available'}>
            Restore
          </Button>
        }
        title="Restore this Official Pattern?"
        description="Restoring makes this Official Pattern available in the Pattern Catalog again."
        confirmLabel="Restore"
        onConfirm={async () => {
          await restoreMutation.mutateAsync();
          toast.success('Pattern restored.');
        }}
      />
    </div>
  );
}
