'use client';

import Image from 'next/image';
import Link from 'next/link';
import { toast } from 'sonner';

import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { DraftStatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { useDiscardDraft } from '@/hooks/use-drafts';
import { formatDateTime } from '@/lib/format';
import type { OfficialPatternDraftView } from '@/lib/types';

export function DraftListItem({ draft }: { draft: OfficialPatternDraftView }) {
  const discardMutation = useDiscardDraft(draft.id);
  const canDiscard = draft.status !== 'published' && draft.status !== 'discarded';

  return (
    <div className="flex items-center gap-4 border-b border-border p-4 last:border-b-0">
      <div className="size-14 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
        {draft.hasPreview ? (
          <Image
            src={`/api/admin/pattern-drafts/${draft.id}/preview`}
            alt="Draft preview"
            width={56}
            height={56}
            unoptimized
            className="size-14 object-cover"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <DraftStatusBadge status={draft.status} />
          <span className="text-xs text-muted-foreground">{formatDateTime(draft.createdAt)}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {draft.width !== null && draft.height !== null
            ? `${draft.width} × ${draft.height} cells`
            : `Target short edge: ${draft.shortEdgeCells} cells`}
          {draft.paletteSize !== null ? ` · ${draft.paletteSize} colors` : ''}
        </p>
        {draft.status === 'failed' && draft.failureReason !== null && (
          <p className="mt-1 text-sm text-destructive">{draft.failureReason}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {draft.status === 'ready' && (
          <Button size="sm" render={<Link href={`/drafts/${draft.id}`} />}>
            Review
          </Button>
        )}
        {draft.status === 'published' && draft.publishedPatternId !== null && (
          <Button size="sm" variant="secondary" render={<Link href={`/patterns/${draft.publishedPatternId}`} />}>
            View Pattern
          </Button>
        )}
        {canDiscard && (
          <ConfirmActionDialog
            trigger={
              <Button size="sm" variant="outline">
                Discard
              </Button>
            }
            title="Discard this Official Pattern Draft?"
            description="Discarding removes this draft from review. It will never appear in the Pattern Catalog. This cannot be undone."
            confirmLabel="Discard"
            destructive
            onConfirm={async () => {
              await discardMutation.mutateAsync();
              toast.success('Draft discarded.');
            }}
          />
        )}
      </div>
    </div>
  );
}
