import React from 'react';
import { Modal, Pressable, Text } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import * as Haptics from 'expo-haptics';

import { LanguageSettingsCard } from '../LanguageSettingsCard';
import * as languageResolution from '@/i18n/languageResolution';
import * as languageOverride from '@/i18n/languageOverride';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, null, name);
  },
}));

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'tr-TR', languageCode: 'tr', regionCode: 'TR' }],
}));

function textValue(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return [value.flatMap(textValue).join('')];
  return [];
}

function allText(instance: ReactTestInstance): string[] {
  return instance.findAllByType(Text).flatMap((node) => textValue(node.props.children));
}

async function renderCard(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<LanguageSettingsCard />);
  });
  return renderer;
}

describe('LanguageSettingsCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(languageOverride, 'getLanguageOverride').mockResolvedValue(null);
    jest.spyOn(languageResolution, 'setActiveLanguageOverride').mockResolvedValue(undefined);
    jest.spyOn(languageResolution, 'clearActiveLanguageOverride').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders trigger card with default system language', async () => {
    const renderer = await renderCard();
    const trigger = renderer.root.findByProps({ testID: 'language-settings-trigger' });
    expect(trigger).toBeDefined();

    const texts = allText(renderer.root);
    expect(texts).toContain('Language');
    expect(texts.some((t) => t.includes('System Language'))).toBe(true);
  });

  it('opens bottom sheet modal on trigger press and lists all supported locales', async () => {
    const renderer = await renderCard();
    const trigger = renderer.root.findByProps({ testID: 'language-settings-trigger' });

    await act(async () => {
      trigger.props.onPress();
    });

    const modal = renderer.root.findByType(Modal);
    expect(modal.props.visible).toBe(true);

    const texts = allText(renderer.root);
    expect(texts).toEqual(
      expect.arrayContaining([
        'Select Language',
        'English',
        'Türkçe',
        'Español',
        'Deutsch',
        'Français',
        'Português (Brasil)',
        'Italiano',
      ]),
    );
  });

  it('selects a locale, triggers haptics, sets override, and closes modal', async () => {
    jest.useFakeTimers();
    const renderer = await renderCard();
    const trigger = renderer.root.findByProps({ testID: 'language-settings-trigger' });

    await act(async () => {
      trigger.props.onPress();
    });

    const trOption = renderer.root.findByProps({ testID: 'language-option-tr' });
    await act(async () => {
      trOption.props.onPress();
    });

    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(languageResolution.setActiveLanguageOverride).toHaveBeenCalledWith('tr');

    act(() => {
      jest.advanceTimersByTime(200);
    });

    const modal = renderer.root.findByType(Modal);
    expect(modal.props.visible).toBe(false);
    jest.useRealTimers();
  });

  it('selects system default option, triggers haptics, clears override, and closes modal', async () => {
    jest.useFakeTimers();
    jest.spyOn(languageOverride, 'getLanguageOverride').mockResolvedValue('de');

    const renderer = await renderCard();
    const trigger = renderer.root.findByProps({ testID: 'language-settings-trigger' });

    await act(async () => {
      trigger.props.onPress();
    });

    const deviceOption = renderer.root.findByProps({ testID: 'language-option-device' });
    await act(async () => {
      deviceOption.props.onPress();
    });

    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(languageResolution.clearActiveLanguageOverride).toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(200);
    });

    const modal = renderer.root.findByType(Modal);
    expect(modal.props.visible).toBe(false);
    jest.useRealTimers();
  });

  it('closes modal on close button press', async () => {
    const renderer = await renderCard();
    const trigger = renderer.root.findByProps({ testID: 'language-settings-trigger' });

    await act(async () => {
      trigger.props.onPress();
    });

    const closeButton = renderer.root.findByProps({ testID: 'language-modal-close' });
    await act(async () => {
      closeButton.props.onPress();
    });

    const modal = renderer.root.findByType(Modal);
    expect(modal.props.visible).toBe(false);
  });
});
