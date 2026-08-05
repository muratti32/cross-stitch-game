import { exitSession, PLAY_TAB_ROOT } from '../exitSession';

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

describe('exitSession', () => {
  it('returns to the session list when the session was opened from the Stitch tab', () => {
    const { router, stack } = makeDeps();

    exitSession({ router, stack });

    expect(router.dismissTo).toHaveBeenCalledWith(PLAY_TAB_ROOT);
    expect(router.navigate).not.toHaveBeenCalled();
    expect(stack.dispatch).not.toHaveBeenCalled();
  });

  it('hands focus back to the originating tab and pops the play stack behind it', () => {
    const { router, stack } = makeDeps();

    exitSession({ router, stack, returnTo: '/(tabs)/(catalog)/pattern-1' });

    expect(router.navigate).toHaveBeenCalledWith('/(tabs)/(catalog)/pattern-1');
    expect(stack.dispatch).toHaveBeenCalledWith({ type: 'POP_TO_TOP' });
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it('pops only after focus has moved, so the session list never mounts on the way out', () => {
    const { router, stack, calls } = makeDeps();

    exitSession({ router, stack, returnTo: '/(tabs)/(profile)' });

    expect(calls).toEqual(['navigate', 'dispatch']);
  });
});
