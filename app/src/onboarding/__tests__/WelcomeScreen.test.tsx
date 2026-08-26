import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { Text } from 'react-native';

const mockNavigate = jest.fn();
const mockSetHandedness = jest.fn();
const mockPersistHandedness = jest.fn().mockResolvedValue(undefined);
const mockSavePosition = jest.fn().mockResolvedValue(undefined);
const mockStartTutorial = jest.fn().mockResolvedValue(undefined);
const mockPrepare = jest.fn().mockResolvedValue({ id: 'session-heart' });

jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: mockNavigate }) }));
jest.mock('@/store/gameplayStore', () => ({ useGameplayStore: () => ({ handedness: 'right', setHandedness: mockSetHandedness }) }));
jest.mock('@/local-db', () => ({ setHandedness: (...args: unknown[]) => mockPersistHandedness(...args) }));
jest.mock('@/onboarding/state', () => ({
  saveOnboardingPosition: (...args: unknown[]) => mockSavePosition(...args),
  startTutorial: (...args: unknown[]) => mockStartTutorial(...args),
}));
jest.mock('@/session-preparation', () => ({ prepareBundledSession: (...args: unknown[]) => mockPrepare(...args) }));
jest.mock('@/bundled-patterns', () => ({ BUNDLED_PATTERNS: [{ id: 'starter_heart', title: 'Cozy Heart', checksum: 'heart-checksum', previewAsset: 1 }] }));
jest.mock('@/components', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PatternImage: () => {
    const MockText = require('react-native').Text;
    return <MockText>heart-preview</MockText>;
  },
  Button: ({ title, onPress }: { title: string; onPress: () => void }) => {
    const MockText = require('react-native').Text;
    return <MockText onPress={onPress}>{title}</MockText>;
  },
}));

import WelcomeScreen from '../../../app/onboarding/welcome';

function press(root: ReactTestInstance, label: string) {
  const node = root.findAllByType(Text).find((candidate) =>
    (Array.isArray(candidate.props.children) ? candidate.props.children.join('') : candidate.props.children) === label,
  )!;
  let target: ReactTestInstance | null = node;
  while (target && typeof target.props.onPress !== 'function') target = target.parent;
  target!.props.onPress();
}

async function renderWelcome() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<WelcomeScreen />);
  });
  return renderer;
}

describe('Welcome screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders Right by default and persists a handedness toggle immediately', async () => {
    const renderer = await renderWelcome();
    expect(renderer.root.findAllByType(Text).map((node) =>
      Array.isArray(node.props.children) ? node.props.children.join('') : node.props.children,
    )).toContain('Controls on the right');
    await act(async () => press(renderer.root, 'Controls on the left'));
    expect(mockSetHandedness).toHaveBeenCalledWith('left');
    expect(mockPersistHandedness).toHaveBeenCalledWith('left');
  });

  it('starts the canonical bundled session without a network dependency', async () => {
    const renderer = await renderWelcome();
    await act(async () => press(renderer.root, 'Start stitching'));
    expect(mockPrepare).toHaveBeenCalledWith('starter_heart', 'heart-checksum');
    expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({ params: { sessionId: 'session-heart' } }));
  });

  it('supports Browse starters and Sign in exits', async () => {
    const renderer = await renderWelcome();
    await act(async () => press(renderer.root, 'Browse starters'));
    expect(mockSavePosition).toHaveBeenCalledWith('deferred');
    expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/(catalog)');
    act(() => press(renderer.root, 'Sign in'));
    expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/(tabs)/(settings)/sign-in', params: { returnTo: '/onboarding/welcome' } });
  });
});
