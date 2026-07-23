import { resolveMembershipTheme } from '../themes';

describe('Premium Theme Collection', () => {
  it('applies the selected cosmetic theme with membership access', () => {
    expect(resolveMembershipTheme('moonlit-aida', true)).toMatchObject({
      id: 'moonlit-aida',
      stitchAppearance: 'cross',
    });
  });

  it('reverts a premium selection to default when membership lapses', () => {
    expect(resolveMembershipTheme('rose-garden', false)).toMatchObject({
      id: 'default',
      premium: false,
    });
  });
});
