import { describe, expect, it } from 'vitest';

import { getPatternActionPolicy } from './pattern-action-policy';

describe('getPatternActionPolicy', () => {
  it('offers generic removal for an Official Pattern', () => {
    expect(getPatternActionPolicy({ patternType: 'official', status: 'available' })).toMatchObject({
      canRemove: true,
      communityRemovalGuidance: null,
    });
  });

  it('omits generic removal for a Community Pattern and directs the operator to moderation', () => {
    expect(getPatternActionPolicy({ patternType: 'community', status: 'available' })).toEqual({
      canRemove: false,
      canRestore: false,
      canWithdraw: false,
      communityRemovalGuidance:
        'Community Patterns can only be removed through Post-Publication Review.',
    });
  });
});
