import type { Href } from 'expo-router';

export const PLAY_TAB_ROOT = '/(tabs)/(play)' as Href;

/**
 * React Navigation's `StackActions.popToTop()` payload, spelled out here because
 * expo-router bundles React Navigation privately and does not re-export the
 * action creators from its public entry point.
 */
const POP_TO_TOP = { type: 'POP_TO_TOP' } as const;

type ExitRouter = {
  navigate: (href: Href) => void;
  dismissTo: (href: Href) => void;
};

type ExitStack = {
  dispatch: (action: Readonly<{ type: string; payload?: object }>) => void;
};

export type ExitSessionOptions = {
  /** Expo Router imperative API. */
  router: ExitRouter;
  /** The `(play)` Stack navigator the session screen lives in. */
  stack: ExitStack;
  /** Where the player came from, when the session was opened outside the Stitch tab. */
  returnTo?: string;
};

/**
 * Leaves a stitching session without stranding it on top of the `(play)` stack.
 *
 * When the session was opened from another tab we first hand focus back to that
 * tab, and only then pop the `(play)` stack. Popping second is deliberate: the
 * pop lands on a navigator that is already off-screen, so the session list never
 * mounts on the way out — no flash, and no wasted `getSessions()` read. Reversing
 * the order reintroduces both.
 *
 * Without the pop the session screen stays on the stack, and the next Stitch tab
 * press restores it instead of the session list (#91).
 */
export function exitSession({ router, stack, returnTo }: ExitSessionOptions): void {
  if (!returnTo) {
    router.dismissTo(PLAY_TAB_ROOT);
    return;
  }

  router.navigate(returnTo as Href);
  stack.dispatch(POP_TO_TOP);
}
