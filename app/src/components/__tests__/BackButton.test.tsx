import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { BackButton } from '../BackButton';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: 'back-icon' }, name);
  },
}));

describe('BackButton', () => {
  it('uses a native icon instead of the unicode arrow in the label', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <BackButton title="← Geri" onPress={jest.fn()} />,
      );
    });

    expect(renderer.root.findByProps({ testID: 'back-icon' }).props.children).toBe('arrow-back');
    expect(renderer.root.findAllByType(Text).map((node) => node.props.children)).toContain('Geri');
    expect(renderer.root.findAllByType(Text).map((node) => node.props.children)).not.toContain('← Geri');
  });
});
