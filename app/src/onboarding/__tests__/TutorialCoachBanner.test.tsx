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
          <TutorialCoachBanner onSkip={onSkip} />
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
    const instruction = renderer.root.findAllByType(Text).find(
      (node) => node.props.children === 'Select DMC 321 Christmas Red.',
    );
    expect(instruction?.props.allowFontScaling).toBe(true);
  });
});
