'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useBulkRemovePatterns } from '@/hooks/use-patterns';
import type {
  AdminPatternListItem,
  BulkRemovePatternsInput,
  BulkRemovePatternsResponse,
} from '@/lib/types';

import {
  bulkRemoveSubmissionFailed,
  initialBulkRemoveDialogState,
} from './bulk-remove-state';

export function BulkRemoveDialog({
  patterns,
  open,
  onOpenChange,
  onSuccess,
}: {
  patterns: AdminPatternListItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (result: BulkRemovePatternsResponse) => void;
}) {
  const [dialogState, setDialogState] = useState(initialBulkRemoveDialogState);
  const [confirmedRequest, setConfirmedRequest] =
    useState<BulkRemovePatternsInput | null>(null);
  const mutation = useBulkRemovePatterns();
  const trimmedReason = dialogState.reason.trim();
  const reasonValid = trimmedReason.length >= 10 && trimmedReason.length <= 2000;

  async function submit(): Promise<void> {
    const request = confirmedRequest ?? {
      batchId: crypto.randomUUID(),
      patternIds: patterns.map((pattern) => pattern.id),
      reason: trimmedReason,
    };
    setConfirmedRequest(request);
    try {
      const result = await mutation.mutateAsync(request);
      setDialogState(initialBulkRemoveDialogState());
      setConfirmedRequest(null);
      onSuccess(result);
      onOpenChange(false);
    } catch (error) {
      setDialogState((state) => bulkRemoveSubmissionFailed(state, error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!mutation.isPending) {
        if (!next) setConfirmedRequest(null);
        onOpenChange(next);
      }
    }}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!mutation.isPending}>
        <DialogHeader>
          <DialogTitle>Remove {patterns.length} Official Patterns?</DialogTitle>
          <DialogDescription>
            This removes every selected Pattern atomically. There is no bulk restore or Undo.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-3">
          {patterns.map((pattern) => (
            <li key={pattern.id} className="flex justify-between gap-4 text-sm">
              <span className="truncate">{pattern.title}</span>
              <span className="shrink-0 capitalize text-muted-foreground">{pattern.status}</span>
            </li>
          ))}
        </ul>
        <label className="space-y-2 text-sm font-medium">
          Removal reason
          <Textarea
            value={dialogState.reason}
            onChange={(event) =>
              setDialogState({ error: null, reason: event.target.value })
            }
            minLength={10}
            maxLength={2000}
            rows={4}
            disabled={mutation.isPending || confirmedRequest !== null}
            aria-describedby="bulk-remove-reason-help"
          />
        </label>
        <p id="bulk-remove-reason-help" className="text-xs text-muted-foreground">
          {trimmedReason.length}/2000 characters; 10 required after trimming.
        </p>
        {dialogState.error !== null && (
          <p role="alert" className="text-sm text-destructive">{dialogState.error}</p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={mutation.isPending} onClick={() => {
            setConfirmedRequest(null);
            onOpenChange(false);
          }}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!reasonValid || mutation.isPending} onClick={() => void submit()}>
            {mutation.isPending ? 'Removing…' : 'Remove selected'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
