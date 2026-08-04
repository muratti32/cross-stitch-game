import * as SecureStore from 'expo-secure-store';

import { resolveMembershipTheme, useMembershipThemePreference } from '../themes';

describe('Premium Theme Collection', () => {
  it('applies the selected cosmetic theme with membership access', () => {
    expect(resolveMembershipTheme('moonlit-aida', true)).toMatchObject({
      id: 'moonlit-aida',
      threadFinish: 'satin',
    });
  });

  it('reverts a premium selection to default when membership lapses', () => {
    expect(resolveMembershipTheme('rose-garden', false)).toMatchObject({
      id: 'default',
      premium: false,
    });
  });

  it('persists the selected Premium theme without erasing it during fallback', async () => {
    const save = jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue();

    await useMembershipThemePreference.getState().selectTheme('rose-garden');

    expect(save).toHaveBeenCalledWith('stitch_wish.membership_theme', 'rose-garden');
    expect(useMembershipThemePreference.getState().selectedThemeId).toBe('rose-garden');
    expect(resolveMembershipTheme('rose-garden', false).id).toBe('default');
    expect(useMembershipThemePreference.getState().selectedThemeId).toBe('rose-garden');
    save.mockRestore();
  });
});
