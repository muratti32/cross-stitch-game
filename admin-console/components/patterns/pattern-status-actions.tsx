'use client';

import Link from 'next/link';
import { toast } from 'sonner';

import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { Button } from '@/components/ui/button';
import { useRemovePattern, useRestorePattern, useWithdrawPattern } from '@/hooks/use-patterns';
import type { AdminPatternDetail } from '@/lib/types';

import { getPatternActionPolicy } from './pattern-action-policy';

export function PatternStatusActions({ pattern }: { pattern: AdminPatternDetail }) {
  const withdrawMutation = useWithdrawPattern(pattern.id);
  const removeMutation = useRemovePattern(pattern.id);
  const restoreMutation = useRestorePattern(pattern.id);
  const policy = getPatternActionPolicy(pattern);

  if (policy.communityRemovalGuidance !== null) {
    return (
      <p className="max-w-md text-sm text-muted-foreground">
        {policy.communityRemovalGuidance}{' '}
        <Link className="font-medium text-foreground underline" href="/post-publication-reviews">
          Open moderation reviews
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmActionDialog
        trigger={
          <Button variant="outline" disabled={!policy.canWithdraw}>
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
          <Button variant="destructive" disabled={!policy.canRemove}>
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
          <Button variant="secondary" disabled={!policy.canRestore}>
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
