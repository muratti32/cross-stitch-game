'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { OfficialPatternDraftStatus } from '@/lib/types';

const STATUS_TABS: { value: 'all' | OfficialPatternDraftStatus; label: string }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Processing', value: 'processing' },
  { label: 'Ready', value: 'ready' },
  { label: 'Failed', value: 'failed' },
  { label: 'Published', value: 'published' },
  { label: 'Discarded', value: 'discarded' },
];

export function DraftStatusTabs({
  value,
  onValueChange,
}: {
  value: 'all' | OfficialPatternDraftStatus;
  onValueChange: (value: 'all' | OfficialPatternDraftStatus) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as 'all' | OfficialPatternDraftStatus)}>
      <TabsList>
        {STATUS_TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
