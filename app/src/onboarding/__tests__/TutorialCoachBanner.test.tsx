import React from 'react';
import { Pressable, Text, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { TutorialCoachBanner } from '../TutorialCoachBanner';

describe('TutorialCoachBanner', () => {
  it('does not intercept unrelated controls and exposes an accessible skip target', () => {
    const onSkip = jest.fn();
    const onUndo = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <View>
          <TutorialCoachBanner beatId="mismatched_tap" onSkip={onSkip} />
          <Pressable accessibilityRole="button" accessibilityLabel="Undo last stitch" onPress={onUndo}>
            <Text>Undo</Text>
          </Pressable>
        </View>,
      );
    });

    act(() => renderer.root.findByProps({ accessibilityLabel: 'Undo last stitch' }).props.onPress());
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();

    act(() => renderer.root.findByProps({ accessibilityLabel: 'Skip tutorial for now' }).props.onPress());
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ accessibilityRole: 'summary' }).props.pointerEvents).toBe('box-none');
    const instruction = renderer.root.findAllByType(Text).find(
      (node) => node.props.children === 'Tap the highlighted different cell. Wrong taps cost nothing.',
    );
    expect(instruction?.props.allowFontScaling).toBe(true);
  });

  it('reassures the player before the mismatched tap', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<TutorialCoachBanner beatId="mismatched_tap" onSkip={jest.fn()} />);
    });
    expect(renderer.root.findAllByType(Text).some((node) =>
      String(node.props.children).includes('cost nothing'),
    )).toBe(true);
  });
});
