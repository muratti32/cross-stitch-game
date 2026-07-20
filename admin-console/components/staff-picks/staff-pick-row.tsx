'use client';

import Image from 'next/image';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toConsolePreviewSrc } from '@/lib/preview-url';
import type { StaffPickItem } from '@/lib/types';

export function StaffPickRow({
  pick,
  position,
  onRemove,
}: {
  pick: StaffPickItem;
  position: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pick.patternId,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 border-b border-border bg-background p-3 last:border-b-0 ${isDragging ? 'z-10 opacity-70' : ''}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="w-6 shrink-0 text-sm font-medium text-muted-foreground">{position}</span>
      <Image
        src={toConsolePreviewSrc(pick.previewUrl)}
        alt={pick.title}
        width={40}
        height={40}
        unoptimized
        className="size-10 shrink-0 rounded-md border border-border object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{pick.title}</p>
        <p className="truncate text-sm text-muted-foreground">{pick.creatorName}</p>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
