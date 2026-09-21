import React from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import SessionScreen from '../../../app/(tabs)/(play)/[sessionId]';
import {
  EconomyApiError,
  LocatorInsufficientBalanceError,
  LocatorPriceChangedError,
  LocatorPriceUnavailableError,
} from '@/api/economy';
import { useGameplayStore } from '@/store/gameplayStore';

const mockRouter = {
  back: jest.fn(),
  navigate: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};
const mockNavigation = {
  getParent: jest.fn(() => ({ setOptions: jest.fn() })),
};
const mockFetchQuery = jest.fn();
const mockInvalidateQueries = jest.fn();
const mockSetQueryData = jest.fn();
const mockFetchCoinBalanceView = jest.fn();
const mockPrepareLocatorAttempt = jest.fn();
const mockCommitLocatorAttempt = jest.fn();
const mockReleaseLocatorAttempt = jest.fn();
const mockCaptureGameplayEvent = jest.fn().mockResolvedValue(undefined);
const mockLocateCell = jest.fn();
const mockFocusCell = jest.fn();
let mockLocatorPrice: number | null | undefined = 5;
let mockIsAccount = true;
let mockRemainingCounts = [1];
let mockNextRemainingCell: number | null = 1;
let renderer: TestRenderer.ReactTestRenderer | null = null;

const mockPatternData = {
  schemaVersion: 1,
  width: 2,
  height: 1,
  palette: [{ dmcCode: '310', name: 'Black', rgbHex: '#000000' }],
  grid: Uint8Array.from([0, 1]),
};
const mockCompleted = Uint8Array.from([0, 0]);
const mockRendererState = {
  focusCell: mockFocusCell,
  getCompletedArray: jest.fn(() => mockCompleted),
  getFocusedCell: jest.fn(() => null),
  isCompleted: jest.fn(() => false),
};

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
    useIsFocused: () => true,
    useLocalSearchParams: () => ({ sessionId: 'local-session-1' }),
    useNavigation: () => mockNavigation,
    useRouter: () => mockRouter,
  };
});

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    fetchQuery: mockFetchQuery,
    invalidateQueries: mockInvalidateQueries,
    setQueryData: mockSetQueryData,
  }),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    Screen: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    Button: ({ title, onPress, disabled }: {
      title: string;
      onPress: () => void;
      disabled?: boolean;
    }) => React.createElement(
      Pressable,
      { disabled, onPress },
      React.createElement(Text, null, title),
    ),
    // This screen suite deliberately keeps the new player-facing sheet real.
    LocatorCoinShortfallSheet:
      require('@/components/LocatorCoinShortfallSheet').LocatorCoinShortfallSheet,
  };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => React.createElement(Text, null, name),
  };
});

jest.mock('@/api/economy', () => {
  const actual = jest.requireActual('@/api/economy');
  return {
    ...actual,
    fetchCoinBalanceView: (...args: unknown[]) => mockFetchCoinBalanceView(...args),
    prepareLocatorAttempt: (...args: unknown[]) => mockPrepareLocatorAttempt(...args),
    commitLocatorAttempt: (...args: unknown[]) => mockCommitLocatorAttempt(...args),
    releaseLocatorAttempt: (...args: unknown[]) => mockReleaseLocatorAttempt(...args),
    useLocatorPrice: () => ({ data: mockLocatorPrice }),
  };
});

jest.mock('@/hooks/useStitchingSession', () => ({
  useStitchingSession: () => ({
    loading: false,
    error: null,
    session: {
      id: 'local-session-1',
      patternId: 'pattern-1',
      remoteSessionId: 'remote-session-1',
      status: 'active',
      title: 'Test Pattern',
    },
    patternData: mockPatternData,
    rendererState: mockRendererState,
    remainingCounts: mockRemainingCounts,
    isSessionCompleted: false,
    canUndo: false,
    totalCellsCount: 1,
    completedCellsCount: 0,
    stitchCell: jest.fn(),
    undo: jest.fn(),
    hasSyncConflict: false,
    dismissSyncConflict: jest.fn(),
    syncTick: 0,
    patternRemoved: false,
  }),
}));

jest.mock('@/renderer', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    StitchRenderer: React.forwardRef((_props: unknown, ref: React.ForwardedRef<unknown>) => {
      React.useImperativeHandle(ref, () => ({
        locateCell: mockLocateCell,
        placeCompletedStitch: jest.fn(),
        undoCompletedStitch: jest.fn(),
      }));
      return React.createElement(View, { testID: 'stitch-renderer' });
    }),
    nextRemainingCell: () => mockNextRemainingCell,
  };
});

jest.mock('@/local-db', () => ({
  createReplaySession: jest.fn(),
  generateUUID: () => 'attempt-1',
}));
jest.mock('@/bundled-patterns', () => ({ BUNDLED_PATTERNS: [] }));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/identity/guestIdentity', () => ({
  useIdentityStore: (selector: (state: { isAccount: boolean }) => unknown) =>
    selector({ isAccount: mockIsAccount }),
}));

jest.mock('@/membership/themes', () => ({
  useActiveMembershipTheme: () => ({
    theme: {
      id: 'default',
      premium: false,
      celebrationSurface: '#fff',
      celebrationAccent: '#000',
    },
  }),
}));

jest.mock('@/onboarding/useTutorialExecutor', () => ({
  useTutorialExecutor: () => ({
    activeDmcCode: null,
    canResume: false,
    coachMarkBeat: null,
    dismissRecap: jest.fn(),
    recapVisible: false,
    resume: jest.fn(),
    selectThreadColor: jest.fn(),
    showThreadPaletteBeat: false,
    skip: jest.fn(),
  }),
}));

jest.mock('@/onboarding/useJustInTimeHints', () => ({
  useJustInTimeHints: () => ({ dismissHint: jest.fn(), visibleHint: null }),
}));

jest.mock('@/onboarding/TutorialCoachBanner', () => ({ TutorialCoachBanner: () => null }));
jest.mock('@/onboarding/TutorialRecapSheet', () => ({ TutorialRecapSheet: () => null }));
jest.mock('@/onboarding/tutorialEvents', () => ({ emitTutorialEvent: jest.fn() }));
jest.mock('@/observability/sentry', () => ({ addScreenMemoryBreadcrumb: jest.fn() }));
jest.mock('@/analytics/renderStopExposure', () => ({ useRenderStopExposure: jest.fn() }));
jest.mock('@/analytics/gameplayEvents', () => ({
  captureGameplayEvent: (...args: unknown[]) => mockCaptureGameplayEvent(...args),
}));

jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Pan = () => {
    const gesture: {
      onUpdate: (callback: (event: { translationY: number }) => void) => typeof gesture;
      onEnd: (callback: (event: { translationY: number; velocityY: number }) => void) => typeof gesture;
      update?: (event: { translationY: number }) => void;
      end?: (event: { translationY: number; velocityY: number }) => void;
    } = {
      onUpdate(callback) {
        gesture.update = callback;
        return gesture;
      },
      onEnd(callback) {
        gesture.end = callback;
        return gesture;
      },
    };
    return gesture;
  };
  return {
    Gesture: { Pan },
    GestureDetector: ({ children, gesture }: { children: React.ReactNode; gesture: unknown }) =>
      React.createElement(View, { gesture, testID: 'locator-gesture' }, children),
  };
});

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

async function renderScreen() {
  await act(async () => {
    renderer = TestRenderer.create(<SessionScreen />);
  });
  return renderer!;
}

async function press(node: ReactTestInstance) {
  await act(async () => {
    node.props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function locatorButton(root: ReactTestInstance) {
  const found = root.findAll((node) =>
    typeof node.props.accessibilityLabel === 'string'
      && node.props.accessibilityLabel.startsWith('Locate next remaining cell of active thread color')
      && typeof node.props.onPress === 'function')[0];
  if (!found) {
    throw new Error(`Locator missing: ${JSON.stringify(root.findAllByType(Text).map((node) => node.props.children))}`);
  }
  return found;
}

function textValues(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).flatMap((node) =>
    typeof node.props.children === 'string' ? [node.props.children] : []);
}

function buttonNamed(root: ReactTestInstance, title: string) {
  return root.findAll((node) =>
    typeof node.props.onPress === 'function'
      && node.findAllByType(Text).some((text) => text.props.children === title))[0];
}

function sheet(root: ReactTestInstance) {
  return root.findByProps({ testID: 'locator-coin-shortfall-sheet' });
}

async function showShortfall(price = 5, balance = 2) {
  mockLocatorPrice = price;
  mockPrepareLocatorAttempt.mockRejectedValueOnce(
    new LocatorInsufficientBalanceError(price, balance),
  );
  const tree = await renderScreen();
  await press(locatorButton(tree.root));
  return tree;
}

function eventCalls(kind: string): unknown[][] {
  return mockCaptureGameplayEvent.mock.calls.filter(([eventKind]) => eventKind === kind);
}

function expectExactAmounts(call: unknown[], price: number, balance: number) {
  expect(call[1]).toEqual({ price, balance });
  expect(Object.keys(call[1] as Record<string, unknown>).sort()).toEqual(['balance', 'price']);
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('ios');
  mockLocatorPrice = 5;
  mockIsAccount = true;
  mockRemainingCounts = [1];
  mockNextRemainingCell = 1;
  mockFetchQuery.mockImplementation(async ({ queryFn }: { queryFn: () => Promise<unknown> }) =>
    queryFn());
  mockFetchCoinBalanceView.mockResolvedValue({ balance: 2, locatorPrice: 5 });
  mockPrepareLocatorAttempt.mockResolvedValue({ attemptId: 'attempt-1' });
  mockCommitLocatorAttempt.mockResolvedValue({ status: 'committed' });
  mockReleaseLocatorAttempt.mockResolvedValue({ status: 'released' });
  useGameplayStore.setState({ selectedColorIndex: 0, handedness: 'right' });
});

afterEach(() => {
  if (renderer) {
    act(() => renderer?.unmount());
    renderer = null;
  }
});

it('continues a cold-price tap into preparation and presents the shortfall sheet', async () => {
  mockLocatorPrice = undefined;
  mockFetchCoinBalanceView.mockResolvedValue({ balance: 2, locatorPrice: 5 });
  mockPrepareLocatorAttempt.mockRejectedValueOnce(new LocatorInsufficientBalanceError(5, 2));

  const tree = await renderScreen();
  await press(locatorButton(tree.root));

  expect(mockFetchCoinBalanceView).toHaveBeenCalledTimes(1);
  expect(mockPrepareLocatorAttempt).toHaveBeenCalledTimes(1);
  expect(sheet(tree.root)).toBeDefined();
});

it.each([
  [5, 2, '2'],
  [5, 0, '0'],
  [5, -3, '-3'],
])('shows the server price and balance without clamping (%s, %s)', async (price, balance, renderedBalance) => {
  const tree = await showShortfall(price, balance);
  const text = textValues(tree.root);

  expect(text).toEqual(expect.arrayContaining(['Locator price', String(price), 'Your balance', renderedBalance]));
  if (balance < 0) {
    expect(tree.root.findByProps({ accessibilityLabel: 'Your balance: -3' })).toBeDefined();
  }
});

it.each(['ios', 'android'] as const)(
  'waits for native %s dismissal before navigating a Registered Account',
  async (os) => {
    setPlatform(os);
    const tree = await showShortfall();
    const primary = buttonNamed(tree.root, 'Get Stitch Coin');
    expect(primary).toBeDefined();
    const modal = tree.root.findByType(Modal);

    if (os === 'ios') {
      await press(primary!);
      expect(mockRouter.push).not.toHaveBeenCalled();
      await act(async () => modal.props.onDismiss());
    } else {
      // Android has no native onDismiss callback. The press only requests
      // hiding; the real sheet reports dismissal on the ensuing visible edge.
      await act(async () => {
        primary!.props.onPress();
        expect(mockRouter.push).not.toHaveBeenCalled();
      });
    }

    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/(tabs)/(profile)/commerce',
      params: { category: 'stitch_coin', source: 'stitch_coin_shortfall' },
    });
  },
);

it('offers the purchase route to an iOS Guest Player', async () => {
  setPlatform('ios');
  mockIsAccount = false;
  const tree = await showShortfall();
  const modal = tree.root.findByType(Modal);

  await press(buttonNamed(tree.root, 'Get Stitch Coin')!);
  expect(mockRouter.push).not.toHaveBeenCalled();
  await act(async () => modal.props.onDismiss());

  expect(mockRouter.push).toHaveBeenCalledTimes(1);
});

it('keeps Android Guest Players on the dismiss-only path from issue #267', async () => {
  setPlatform('android');
  mockIsAccount = false;
  const tree = await showShortfall();

  expect(buttonNamed(tree.root, 'Get Stitch Coin')).toBeUndefined();
  expect(buttonNamed(tree.root, 'Not Now')).toBeDefined();
});

it.each(['button', 'backdrop', 'back', 'gesture'] as const)(
  'dismisses through %s without spending, navigating, or moving the viewport',
  async (route) => {
    const tree = await showShortfall();
    const before = {
      prepare: mockPrepareLocatorAttempt.mock.calls.length,
      commit: mockCommitLocatorAttempt.mock.calls.length,
      release: mockReleaseLocatorAttempt.mock.calls.length,
    };

    if (route === 'button') {
      await press(buttonNamed(tree.root, 'Not Now')!);
    } else if (route === 'backdrop') {
      await press(tree.root.findByProps({ accessibilityLabel: 'Close' }));
    } else if (route === 'back') {
      await act(async () => tree.root.findByType(Modal).props.onRequestClose());
    } else {
      const gesture = tree.root.findByProps({ testID: 'locator-gesture' }).props.gesture as {
        end: (event: { translationY: number; velocityY: number }) => void;
      };
      await act(async () => gesture.end({ translationY: 90, velocityY: 0 }));
    }

    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockPrepareLocatorAttempt).toHaveBeenCalledTimes(before.prepare);
    expect(mockCommitLocatorAttempt).toHaveBeenCalledTimes(before.commit);
    expect(mockReleaseLocatorAttempt).toHaveBeenCalledTimes(before.release);
    // Neither the canvas focus nor the locate animation ran, so the viewport
    // the player was looking at is exactly where they left it.
    expect(mockLocateCell).not.toHaveBeenCalled();
    expect(mockFocusCell).not.toHaveBeenCalled();
  },
);

// The pending purchase intent lives in a ref that only a dismissal clears.
// Leaving the session while the sheet is up must not strand a navigation that
// fires into a screen the player has already left.
it('strands no navigation when the session unmounts while the sheet is up', async () => {
  const tree = await showShortfall();
  await press(buttonNamed(tree.root, 'Get Stitch Coin')!);

  await act(async () => tree.unmount());
  renderer = null;

  expect(mockRouter.push).not.toHaveBeenCalled();
});

it('reports one exact shown payload per presentation and one exact CTA payload', async () => {
  const tree = await showShortfall(5, -3);

  // A normal parent re-render must not duplicate the presentation event.
  await act(async () => tree.update(<SessionScreen />));
  expect(eventCalls('locator_coin_shortfall_shown')).toHaveLength(1);

  await press(buttonNamed(tree.root, 'Not Now')!);
  await act(async () => tree.root.findByType(Modal).props.onDismiss());
  mockPrepareLocatorAttempt.mockRejectedValueOnce(new LocatorInsufficientBalanceError(5, -3));
  await press(locatorButton(tree.root));

  const shown = eventCalls('locator_coin_shortfall_shown');
  expect(shown).toHaveLength(2);
  shown.forEach((call) => expectExactAmounts(call, 5, -3));

  await press(buttonNamed(tree.root, 'Get Stitch Coin')!);
  const cta = eventCalls('locator_coin_shortfall_cta_pressed');
  expect(cta).toHaveLength(1);
  expectExactAmounts(cta[0], 5, -3);
});

it('exposes the sheet title, amounts, backdrop, and actions accessibly', async () => {
  const tree = await showShortfall(5, 2);

  expect(tree.root.findByProps({ accessibilityRole: 'header' }).props.children)
    .toBe('Not Enough Stitch Coin');
  expect(tree.root.findByProps({ accessible: true, accessibilityLabel: 'Locator price: 5' }))
    .toBeDefined();
  expect(tree.root.findByProps({ accessible: true, accessibilityLabel: 'Your balance: 2' }))
    .toBeDefined();
  expect(tree.root.findByProps({ accessibilityRole: 'button', accessibilityLabel: 'Close' }))
    .toBeDefined();
  expect(buttonNamed(tree.root, 'Get Stitch Coin')).toBeDefined();
  expect(buttonNamed(tree.root, 'Not Now')).toBeDefined();
});

it('locates the target only after an affordable attempt commits', async () => {
  const tree = await renderScreen();
  await press(locatorButton(tree.root));

  expect(mockCommitLocatorAttempt).toHaveBeenCalledTimes(1);
  expect(mockLocateCell).toHaveBeenCalledWith(1, 0);
  expect(tree.root.findAllByProps({ testID: 'locator-coin-shortfall-sheet' })).toHaveLength(0);
});

it('does not reserve or show a sheet when the active color has no target', async () => {
  mockNextRemainingCell = null;
  const tree = await renderScreen();
  await press(locatorButton(tree.root));

  expect(mockPrepareLocatorAttempt).not.toHaveBeenCalled();
  expect(tree.root.findAllByProps({ testID: 'locator-coin-shortfall-sheet' })).toHaveLength(0);
});

it('keeps a changed Locator Price on the Alert path', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockPrepareLocatorAttempt.mockRejectedValueOnce(new LocatorPriceChangedError(7, 2));
  const tree = await renderScreen();
  await press(locatorButton(tree.root));

  expect(alert).toHaveBeenCalled();
  expect(tree.root.findAllByProps({ testID: 'locator-coin-shortfall-sheet' })).toHaveLength(0);
  alert.mockRestore();
});

it.each([
  ['rejected balance fetch', () => new Error('offline')],
  ['economy backend failure', () => new EconomyApiError(503, 'offline', 'offline')],
])('keeps %s on the Alert path', async (_label, makeError) => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  if (_label === 'rejected balance fetch') {
    mockLocatorPrice = undefined;
    mockFetchCoinBalanceView.mockRejectedValueOnce(makeError());
  } else {
    mockPrepareLocatorAttempt.mockRejectedValueOnce(makeError());
  }
  const tree = await renderScreen();
  await press(locatorButton(tree.root));

  expect(alert).toHaveBeenCalled();
  expect(tree.root.findAllByProps({ testID: 'locator-coin-shortfall-sheet' })).toHaveLength(0);
  alert.mockRestore();
});

it('keeps an unavailable cold Locator Price on the Alert path', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockLocatorPrice = undefined;
  mockFetchCoinBalanceView.mockResolvedValueOnce({ balance: 2, locatorPrice: null });
  // The screen creates this error after the cold view reports no usable price.
  expect(new LocatorPriceUnavailableError()).toBeInstanceOf(EconomyApiError);
  const tree = await renderScreen();
  await press(locatorButton(tree.root));

  expect(alert).toHaveBeenCalled();
  expect(mockPrepareLocatorAttempt).not.toHaveBeenCalled();
  expect(tree.root.findAllByProps({ testID: 'locator-coin-shortfall-sheet' })).toHaveLength(0);
  alert.mockRestore();
});
