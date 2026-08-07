import type { PatternStatus, PatternType } from '@/lib/types';

type PatternActionPolicy = {
  canRemove: boolean;
  canRestore: boolean;
  canWithdraw: boolean;
  communityRemovalGuidance: string | null;
};

export function getPatternActionPolicy(pattern: {
  patternType: PatternType;
  status: PatternStatus;
}): PatternActionPolicy {
  if (pattern.patternType === 'community') {
    return {
      canRemove: false,
      canRestore: false,
      canWithdraw: false,
      communityRemovalGuidance:
        'Community Patterns can only be removed through Post-Publication Review.',
    };
  }

  const heldForReview = pattern.status === 'review_hold';
  return {
    canRemove: !heldForReview && pattern.status !== 'removed',
    canRestore: !heldForReview && pattern.status !== 'available',
    canWithdraw: !heldForReview && pattern.status !== 'withdrawn',
    communityRemovalGuidance: null,
  };
}
