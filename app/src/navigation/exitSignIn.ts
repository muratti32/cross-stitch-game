import type { Href } from 'expo-router';

/** The `(settings)` Stack the sign-in screen is always pushed onto. */
export const SETTINGS_TAB_ROOT = '/(tabs)/(settings)' as Href;

/**
 * React Navigation's `StackActions.popToTop()` payload, spelled out here for the
 * same reason as in `exitSession`: expo-router bundles React Navigation privately
 * and does not re-export the action creators.
 */
const POP_TO_TOP = { type: 'POP_TO_TOP' } as const;

type ExitRouter = {
  navigate: (href: Href) => void;
  dismissTo: (href: Href) => void;
};

type ExitStack = {
  dispatch: (action: Readonly<{ type: string; payload?: object }>) => void;
};

export type ExitSignInOptions = {
  /** Expo Router imperative API. */
  router: ExitRouter;
  /** The `(settings)` Stack navigator the sign-in screen lives in. */
  stack: ExitStack;
  /** Where the player is headed now that the sign-in screen is done with them. */
  target: Href;
};

function targetPathname(target: Href): string {
  if (typeof target === 'string') return target;
  const pathname = (target as { pathname?: string }).pathname;
  return pathname ?? '';
}

/**
 * Leaves the sign-in screen without stranding it on the `(settings)` stack.
 *
 * Every entry point pushes `/(tabs)/(settings)/sign-in` onto the Settings tab's
 * Stack, but most of them send the player somewhere else entirely once sign-in
 * succeeds - onboarding, Commerce, the Profile tab. A plain `replace()` moves
 * focus to that destination and leaves the sign-in route sitting on top of the
 * `(settings)` stack, still mounted with its six-digit code step. The next
 * Settings tab press restores it, and the screen's own `isAccount` exit never
 * re-fires because the player is already signed in by then - so they are stuck
 * on the code screen until the app is restarted (#223).
 *
 * When the destination is inside the Settings tab we simply dismiss back down to
 * it. Otherwise we hand focus to the destination first and pop the `(settings)`
 * stack behind it, exactly as `exitSession` does for the `(play)` stack (#91):
 * popping second means the settings list never mounts on the way out.
 */
export function exitSignIn({ router, stack, target }: ExitSignInOptions): void {
  if (targetPathname(target).startsWith('/(tabs)/(settings)')) {
    router.dismissTo(target);
    return;
  }

  router.navigate(target);
  stack.dispatch(POP_TO_TOP);
}
