import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TutorialRecapSheet } from '../TutorialRecapSheet';

describe('TutorialRecapSheet', () => {
  it('continues on dismissal and exposes the two completion exits', () => {
    const onContinue = jest.fn();
    const onBrowsePatterns = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <TutorialRecapSheet visible onContinue={onContinue} onBrowsePatterns={onBrowsePatterns} />,
      );
    });

    expect(renderer.root.findByProps({ accessibilityRole: 'summary' }).children).toBeTruthy();
    act(() => renderer.root.findByProps({ title: 'Continue stitching' }).props.onPress());
    act(() => renderer.root.findByProps({ title: 'Browse patterns' }).props.onPress());
    act(() => renderer.root.findByProps({ accessibilityLabel: 'Continue stitching' }).props.onPress());

    expect(onContinue).toHaveBeenCalledTimes(2);
    expect(onBrowsePatterns).toHaveBeenCalledTimes(1);
  });
});
