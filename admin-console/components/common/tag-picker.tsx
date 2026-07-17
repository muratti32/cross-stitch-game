'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Tag } from '@/lib/types';

function labelFor(tag: Tag): string {
  return tag.labels.find((label) => label.locale === 'en')?.label ?? tag.labels[0]?.label ?? tag.code;
}

export function TagPicker({
  tags,
  value,
  onChange,
  max,
}: {
  tags: Tag[];
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
}) {
  const selectableTags = tags.filter((tag) => tag.active || value.includes(tag.code));
  const atLimit = value.length >= max;

  function toggle(code: string): void {
    if (value.includes(code)) {
      onChange(value.filter((existing) => existing !== code));
      return;
    }
    if (atLimit) {
      return;
    }
    onChange([...value, code]);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 rounded-lg border border-input p-2">
        {selectableTags.length === 0 && (
          <p className="p-1 text-sm text-muted-foreground">No Catalog Tags yet.</p>
        )}
        {selectableTags.map((tag) => {
          const isSelected = value.includes(tag.code);
          return (
            <button
              key={tag.code}
              type="button"
              disabled={!isSelected && atLimit}
              onClick={() => toggle(tag.code)}
              className="disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Badge
                variant={isSelected ? 'default' : 'outline'}
                className={cn('cursor-pointer', !tag.active && 'italic')}
              >
                {labelFor(tag)}
                {!tag.active && ' (inactive)'}
              </Badge>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {value.length} / {max} tags selected
      </p>
    </div>
  );
}
