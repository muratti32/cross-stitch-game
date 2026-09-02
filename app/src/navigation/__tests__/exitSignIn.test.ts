import { exitSignIn, SETTINGS_TAB_ROOT } from '../exitSignIn';

const makeDeps = () => {
  const calls: string[] = [];
  const router = {
    navigate: jest.fn(() => {
      calls.push('navigate');
    }),
    dismissTo: jest.fn(() => {
      calls.push('dismissTo');
    }),
  };
  const stack = {
    dispatch: jest.fn(() => {
      calls.push('dispatch');
    }),
  };
  return { router, stack, calls };
};

describe('exitSignIn', () => {
  it('dismisses down to the settings list when that is where the player is headed', () => {
    const { router, stack } = makeDeps();

    exitSignIn({ router, stack, target: SETTINGS_TAB_ROOT });

    expect(router.dismissTo).toHaveBeenCalledWith(SETTINGS_TAB_ROOT);
    expect(router.navigate).not.toHaveBeenCalled();
    expect(stack.dispatch).not.toHaveBeenCalled();
  });

  it('dismisses for any other route inside the Settings tab', () => {
    const { router, stack } = makeDeps();

    exitSignIn({ router, stack, target: '/(tabs)/(settings)/blocked-creators' });

    expect(router.dismissTo).toHaveBeenCalledWith('/(tabs)/(settings)/blocked-creators');
    expect(stack.dispatch).not.toHaveBeenCalled();
  });

  // Regression (#223): a plain replace() left the sign-in screen mounted on the
  // (settings) stack, so the next Settings tab press restored the code step.
  it('hands focus to the destination tab and pops the settings stack behind it', () => {
    const { router, stack } = makeDeps();

    exitSignIn({ router, stack, target: '/(tabs)/(profile)' });

    expect(router.navigate).toHaveBeenCalledWith('/(tabs)/(profile)');
    expect(stack.dispatch).toHaveBeenCalledWith({ type: 'POP_TO_TOP' });
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it('pops only after focus has moved, so the settings list never mounts on the way out', () => {
    const { router, stack, calls } = makeDeps();

    exitSignIn({ router, stack, target: '/onboarding/welcome' });

    expect(calls).toEqual(['navigate', 'dispatch']);
  });

  it('reads the destination out of an object href', () => {
    const { router, stack } = makeDeps();
    const target = {
      pathname: '/(tabs)/(profile)/commerce',
      params: { source: 'sign_in_return' },
    } as const;

    exitSignIn({ router, stack, target });

    expect(router.navigate).toHaveBeenCalledWith(target);
    expect(stack.dispatch).toHaveBeenCalledWith({ type: 'POP_TO_TOP' });
  });
});
