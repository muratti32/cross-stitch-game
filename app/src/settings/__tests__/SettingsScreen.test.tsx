import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import SettingsScreen from '../../../app/(tabs)/(settings)/index';

let mockIsAccount = false;
let mockDeletionStatus: { status: string; recoveryWindowEndsAt?: string } | undefined;

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => React.createElement(Text, null, name),
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    AccountSection: () => React.createElement(Text, null, 'AccountSection'),
    Button: ({ title, onPress }: { title: string; onPress?: () => void }) =>
      React.createElement(Text, { onPress }, title),
    Card: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    Screen: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    ThemeCollectionCard: () => React.createElement(Text, null, 'ThemeCollectionCard'),
  };
});

jest.mock('@/store', () => ({
  useGameplayStore: () => ({
    handedness: 'right',
    setHandedness: jest.fn(),
    showGridLines: true,
    toggleGridLines: jest.fn(),
  }),
}));

jest.mock('@/hooks/useHealthCheck', () => ({
  useHealthCheck: () => ({
    data: { checks: { postgres: 'up', redis: 'up' }, status: 'ok' },
    error: null,
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/hooks/useBackendSession', () => ({
  useBackendSession: () => ({ data: undefined, error: null, isLoading: false }),
}));

jest.mock('@/local-db', () => ({ setHandedness: jest.fn() }));

jest.mock('@/identity/identityLogic', () => ({ shortenGuestId: () => 'guest-1234' }));

jest.mock('@/identity/guestIdentity', () => ({
  logout: jest.fn(),
  removeLocalData: jest.fn(),
  resetGuestData: jest.fn(),
  useIdentityStore: (selector: (state: { isAccount: boolean }) => unknown) =>
    selector({ isAccount: mockIsAccount }),
}));

jest.mock('@/api/accountDeletion', () => ({
  AccountDeletionApiError: class extends Error {},
  useAccountDeletionStatus: () => ({
    data: mockDeletionStatus,
    error: null,
    isLoading: false,
    refetch: jest.fn(),
  }),
  useCancelAccountDeletion: () => ({ mutateAsync: jest.fn() }),
  useRequestAccountDeletion: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock('@/navigation/foregroundEntryNavigation', () => ({
  withProtectedRoundTrip: (_key: string, run: () => Promise<unknown>) => run(),
}));

function textValue(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return [value.flatMap(textValue).join('')];
  return [];
}

function allText(instance: ReactTestInstance): string[] {
  return instance.findAllByType(Text).flatMap((node) => textValue(node.props.children));
}

async function renderScreen(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<SettingsScreen />);
  });
  return renderer;
}

describe('SettingsScreen data section', () => {
  beforeEach(() => {
    mockIsAccount = false;
    mockDeletionStatus = undefined;
  });

  it('offers Guest Data Reset to a Guest Player', async () => {
    const renderer = await renderScreen();

    const text = allText(renderer.root);
    expect(text).toContain('Reset guest data');
    expect(text).toContain('Remove local data');
    expect(text).not.toContain('Delete Account');
    expect(text.join(' ')).toContain('Consumables and private Guest data cannot be recovered');
  });

  it('keeps Account Deletion reachable for a Registered Account', async () => {
    mockIsAccount = true;

    const renderer = await renderScreen();

    const text = allText(renderer.root);
    // The Data card belongs to both identities: only the Guest reset row is Guest-only.
    expect(text).toContain('Delete Account');
    expect(text).toContain('Remove local data');
    expect(text).not.toContain('Reset guest data');
  });

  it('surfaces a pending deletion with its cancel action', async () => {
    mockIsAccount = true;
    mockDeletionStatus = { recoveryWindowEndsAt: '2026-09-30T00:00:00.000Z', status: 'pending' };

    const renderer = await renderScreen();

    const text = allText(renderer.root);
    expect(text).toContain('Account Deletion Pending');
    expect(text).toContain('Cancel deletion');
    // The pending state replaces the Delete Account row rather than hiding the card.
    expect(text).toContain('Remove local data');
    expect(text).not.toContain('Delete Account');
  });
});
