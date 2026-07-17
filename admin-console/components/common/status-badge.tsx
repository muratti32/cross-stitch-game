import { Badge } from '@/components/ui/badge';
import type { OfficialPatternDraftStatus, PatternStatus } from '@/lib/types';

const PATTERN_STATUS_LABEL: Record<PatternStatus, string> = {
  available: 'Available',
  removed: 'Removed',
  withdrawn: 'Withdrawn',
};

const PATTERN_STATUS_VARIANT: Record<PatternStatus, 'default' | 'secondary' | 'destructive'> = {
  available: 'default',
  removed: 'destructive',
  withdrawn: 'secondary',
};

export function PatternStatusBadge({ status }: { status: PatternStatus }) {
  return <Badge variant={PATTERN_STATUS_VARIANT[status]}>{PATTERN_STATUS_LABEL[status]}</Badge>;
}

const DRAFT_STATUS_LABEL: Record<OfficialPatternDraftStatus, string> = {
  discarded: 'Discarded',
  failed: 'Failed',
  pending: 'Pending',
  processing: 'Processing',
  published: 'Published',
  ready: 'Ready for review',
};

const DRAFT_STATUS_VARIANT: Record<
  OfficialPatternDraftStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  discarded: 'outline',
  failed: 'destructive',
  pending: 'secondary',
  processing: 'secondary',
  published: 'default',
  ready: 'default',
};

export function DraftStatusBadge({ status }: { status: OfficialPatternDraftStatus }) {
  return <Badge variant={DRAFT_STATUS_VARIANT[status]}>{DRAFT_STATUS_LABEL[status]}</Badge>;
}
