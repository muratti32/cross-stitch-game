'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { PatternStatus } from '@/lib/types';

const STATUS_TABS: { value: 'all' | PatternStatus; label: string }[] = [
  { label: 'All', value: 'all' },
  { label: 'Available', value: 'available' },
  { label: 'Withdrawn', value: 'withdrawn' },
  { label: 'Removed', value: 'removed' },
];

export function PatternStatusTabs({
  value,
  onValueChange,
}: {
  value: 'all' | PatternStatus;
  onValueChange: (value: 'all' | PatternStatus) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as 'all' | PatternStatus)}>
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
