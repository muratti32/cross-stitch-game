'use client';

import { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Star } from 'lucide-react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useReplaceStaffPicks, useStaffPicks } from '@/hooks/use-staff-picks';
import { ApiError } from '@/lib/client/fetcher';
import type { StaffPickItem } from '@/lib/types';

import { AddStaffPickDialog } from './add-staff-pick-dialog';
import { StaffPickRow } from './staff-pick-row';

export function StaffPicksView() {
  const staffPicksQuery = useStaffPicks();
  const replaceMutation = useReplaceStaffPicks();

  // null means "mirror the server list"; any local edit takes a snapshot that
  // is only persisted through the single atomic PUT.
  const [localOrder, setLocalOrder] = useState<StaffPickItem[] | null>(null);

  const serverPicks = staffPicksQuery.data;
  const picks = localOrder ?? serverPicks ?? [];
  const isDirty = localOrder !== null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (over === null || active.id === over.id) {
      return;
    }
    const current = localOrder ?? serverPicks ?? [];
    const fromIndex = current.findIndex((pick) => pick.patternId === active.id);
    const toIndex = current.findIndex((pick) => pick.patternId === over.id);
    if (fromIndex === -1 || toIndex === -1) {
      return;
    }
    setLocalOrder(arrayMove(current, fromIndex, toIndex));
  }

  function handleAdd(pick: StaffPickItem): void {
    const current = localOrder ?? serverPicks ?? [];
    if (current.some((existing) => existing.patternId === pick.patternId)) {
      return;
    }
    setLocalOrder([...current, pick]);
  }

  function handleRemove(patternId: string): void {
    const current = localOrder ?? serverPicks ?? [];
    setLocalOrder(current.filter((pick) => pick.patternId !== patternId));
  }

  async function handleSave(): Promise<void> {
    if (localOrder === null) {
      return;
    }
    try {
      await replaceMutation.mutateAsync(localOrder.map((pick) => pick.patternId));
      setLocalOrder(null);
      toast.success('Staff Picks saved.');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to save Staff Picks.');
    }
  }

  return (
    <div>
      <PageHeader
        title="Staff Picks"
        description="Ordered list of featured Official Patterns. Changes apply only when saved, as one atomic replacement."
        actions={
          <>
            {isDirty && (
              <Button
                variant="ghost"
                disabled={replaceMutation.isPending}
                onClick={() => setLocalOrder(null)}
              >
                Discard changes
              </Button>
            )}
            <AddStaffPickDialog pickedIds={picks.map((pick) => pick.patternId)} onAdd={handleAdd} />
            <Button
              disabled={!isDirty || replaceMutation.isPending}
              onClick={() => void handleSave()}
            >
              {replaceMutation.isPending ? 'Saving…' : 'Save order'}
            </Button>
          </>
        }
      />

      {staffPicksQuery.isPending && (
        <Card className="space-y-2 p-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </Card>
      )}

      {staffPicksQuery.isError && (
        <ErrorState
          message={
            staffPicksQuery.error instanceof ApiError
              ? staffPicksQuery.error.message
              : 'Failed to load Staff Picks.'
          }
          onRetry={() => void staffPicksQuery.refetch()}
        />
      )}

      {serverPicks !== undefined && picks.length === 0 && (
        <EmptyState
          icon={Star}
          title="No Staff Picks"
          message="Add available catalog Patterns to feature them in the app."
        />
      )}

      {serverPicks !== undefined && picks.length > 0 && (
        <Card className="p-0">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={picks.map((pick) => pick.patternId)}
              strategy={verticalListSortingStrategy}
            >
              {picks.map((pick, index) => (
                <StaffPickRow
                  key={pick.patternId}
                  pick={pick}
                  position={index + 1}
                  onRemove={() => handleRemove(pick.patternId)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </Card>
      )}
    </div>
  );
}
