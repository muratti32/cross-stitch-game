// Reanimated's native worklets runtime cannot initialise under jest-expo, and
// the library's own mock entry point still pulls that runtime in. Suites get a
// minimal JS stand-in instead: animated views render as plain views and the
// animation helpers are no-ops, which is all the screen tests observe.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');

  const AnimatedView = React.forwardRef((props, ref) =>
    React.createElement(View, { ...props, ref }));
  AnimatedView.displayName = 'Animated.View';

  return {
    __esModule: true,
    default: { View: AnimatedView },
    useSharedValue: (initial) => ({ value: initial }),
    useAnimatedStyle: (factory) => factory(),
    withSpring: (toValue) => toValue,
    withTiming: (toValue) => toValue,
    withSequence: (...values) => values[values.length - 1],
    withDelay: (_delay, value) => value,
    runOnJS: (fn) => fn,
  };
});

// Sentry ships untranspiled ESM that jest cannot parse, and the Analytics
// Mirror reports failures through it. Every export is a no-op spy; suites that
// care about reporting assert on the mirror's observable behaviour instead.
jest.mock('@sentry/react-native', () => {
  const spies = {};
  return new Proxy(
    {},
    {
      get: (_target, name) => {
        if (!(name in spies)) spies[name] = jest.fn();
        return spies[name];
      },
    },
  );
});

// ADR-0055: the Analytics Mirror talks to a native module that cannot load
// under jest. Suites get a JS stand-in so the mirror's real filtering, naming
// and consent logic still runs and can be observed.
jest.mock('@react-native-firebase/analytics', () => ({
  __esModule: true,
  getAnalytics: jest.fn(() => ({})),
  logEvent: jest.fn(() => Promise.resolve()),
  logScreenView: jest.fn(() => Promise.resolve()),
  setAnalyticsCollectionEnabled: jest.fn(() => Promise.resolve()),
  setUserId: jest.fn(() => Promise.resolve()),
  setUserProperty: jest.fn(() => Promise.resolve()),
}));

// #155/#157: initializes the REAL i18next instance with the REAL English
// (and Turkish) resources - never a mock of t(). Roughly forty existing
// test files locate and press elements by their visible English label, and
// the migration gate keeps the active language pinned to English, so this
// is a no-op change in what those suites see while giving a key missing
// from English the power to fail the whole suite, not just CI's locale
// parity check.
require('./src/i18n/i18n').initI18n();
