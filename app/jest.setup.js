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
