import React from 'react';
import { Text, TextInput } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import SettingsScreen from '../../../app/(tabs)/(settings)/index';
import { AccountDeletionApiError } from '@/api/accountDeletion';
import { AccountReauthenticationApiError } from '@/api/accountReauthentication';

let mockIsAccount = false;
let mockDeletionStatus: { status: string; recoveryWindowEndsAt?: string } | undefined;
let mockDeletionError: Error | null = null;
let mockMembershipActive = false;
const mockRefetchDeletionStatus = jest.fn();
const mockRequestDeletion = jest.fn();
const mockCancelDeletion = jest.fn();
const mockLogout = jest.fn();
const mockGetIdentities = jest.fn();
const mockReauthenticateEmail = jest.fn();
const mockReauthenticateFirebase = jest.fn();
const mockRequestEmailCode = jest.fn();
const mockAppleProof = jest.fn();
const mockGoogleProof = jest.fn();

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => React.createElement(Text, null, name) };
});
jest.mock('@/components', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    AccountSection: () => React.createElement(Text, null, 'AccountSection'),
    Button: ({ title, onPress, disabled }: { title: string; onPress?: () => void; disabled?: boolean }) => React.createElement(Text, { onPress: disabled ? undefined : onPress }, title),
    Card: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    Screen: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    ThemeCollectionCard: () => React.createElement(Text, null, 'ThemeCollectionCard'),
  };
});
jest.mock('@/store', () => ({ useGameplayStore: () => ({ handedness: 'right', setHandedness: jest.fn(), showGridLines: true, toggleGridLines: jest.fn() }) }));
jest.mock('@/hooks/useHealthCheck', () => ({ useHealthCheck: () => ({ data: { checks: { postgres: 'up', redis: 'up' }, status: 'ok' }, error: null, isLoading: false, isRefetching: false, refetch: jest.fn() }) }));
jest.mock('@/hooks/useBackendSession', () => ({ useBackendSession: () => ({ data: undefined, error: null, isLoading: false }) }));
jest.mock('@/local-db', () => ({ setHandedness: jest.fn() }));
jest.mock('@/identity/identityLogic', () => ({ shortenGuestId: () => 'guest-1234' }));
jest.mock('@/identity/guestIdentity', () => ({
  logout: (...args: unknown[]) => mockLogout(...args), removeLocalData: jest.fn(), resetGuestData: jest.fn(),
  useIdentityStore: (selector: (state: { isAccount: boolean }) => unknown) => selector({ isAccount: mockIsAccount }),
}));
jest.mock('@/api/accountDeletion', () => {
  class MockError extends Error {
    status: number; reason: string | null; reauthenticationRequired: boolean;
    constructor(mockStatus: number, mockMessage: string, mockReason: string | null, mockReauthenticationRequired = false) {
      super(mockMessage); this.status = mockStatus; this.reason = mockReason; this.reauthenticationRequired = mockReauthenticationRequired;
    }
  }
  return {
    AccountDeletionApiError: MockError,
    useAccountDeletionStatus: () => ({ data: mockDeletionStatus, error: mockDeletionError, isLoading: false, refetch: mockRefetchDeletionStatus }),
    useCancelAccountDeletion: () => ({ mutateAsync: mockCancelDeletion }), useRequestAccountDeletion: () => ({ mutateAsync: mockRequestDeletion }),
  };
});
jest.mock('@/api/membership', () => ({ useMembership: () => ({ data: { active: mockMembershipActive } }) }));
jest.mock('@/api/accountReauthentication', () => {
  class MockError extends Error {
    status: number; reason: string | null;
    constructor(mockStatus: number, mockReason: string | null, mockMessage: string) { super(mockMessage); this.status = mockStatus; this.reason = mockReason; }
  }
  return {
    AccountReauthenticationApiError: MockError,
    getReauthenticationIdentities: (...args: unknown[]) => mockGetIdentities(...args),
    reauthenticateWithEmail: (...args: unknown[]) => mockReauthenticateEmail(...args),
    reauthenticateWithFirebase: (...args: unknown[]) => mockReauthenticateFirebase(...args),
    requestReauthenticationEmailCode: (...args: unknown[]) => mockRequestEmailCode(...args),
  };
});
jest.mock('@/identity/firebaseSso', () => ({
  acquireAppleProviderIdToken: (...args: unknown[]) => mockAppleProof(...args),
  acquireGoogleProviderIdToken: (...args: unknown[]) => mockGoogleProof(...args),
}));
jest.mock('@/navigation/foregroundEntryNavigation', () => ({ withProtectedRoundTrip: (_key: string, run: () => Promise<unknown>) => run() }));

function textValue(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return [value.flatMap(textValue).join('')];
  return [];
}
function allText(instance: ReactTestInstance): string[] { return instance.findAllByType(Text).flatMap((node) => textValue(node.props.children)); }
async function renderScreen(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<SettingsScreen />); });
  return renderer;
}
async function press(renderer: TestRenderer.ReactTestRenderer, title: string): Promise<void> {
  const textNode = renderer.root.findAllByType(Text).find((item) => textValue(item.props.children).join('') === title);
  let node: ReactTestInstance | null = textNode ?? null;
  while (node !== null && typeof node.props.onPress !== 'function') node = node.parent;
  expect(node).not.toBeNull();
  await act(async () => { await node?.props.onPress(); });
}
async function submitTypedDeletion(renderer: TestRenderer.ReactTestRenderer): Promise<void> {
  await press(renderer, 'Delete Account');
  await press(renderer, 'Continue');
  const input = renderer.root.findAllByType(TextInput).find((node) => node.props.placeholder === 'DELETE');
  await act(async () => { input?.props.onChangeText('DELETE'); });
  await press(renderer, 'Confirm');
}

describe('SettingsScreen account deletion', () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockIsAccount = true; mockDeletionStatus = { status: 'none' }; mockDeletionError = null; mockMembershipActive = false;
    mockRequestDeletion.mockResolvedValue({ status: 'pending', recoveryWindowEndsAt: '2026-09-30T00:00:00.000Z' });
    mockGetIdentities.mockResolvedValue([]);
    mockAppleProof.mockResolvedValue({ kind: 'token', idToken: 'apple-token' });
    mockGoogleProof.mockResolvedValue({ kind: 'token', idToken: 'google-token' });
  });

  it('shows normal status directly below Account', async () => {
    const text = allText((await renderScreen()).root);
    expect(text.indexOf('AccountSection')).toBeLessThan(text.indexOf('Account Deletion'));
    expect(text).toContain('Delete Account');
  });

  it('keeps the action on status failure and retries', async () => {
    mockDeletionStatus = undefined; mockDeletionError = new Error('network');
    const renderer = await renderScreen();
    expect(allText(renderer.root)).toEqual(expect.arrayContaining(['Delete Account', 'Could not check deletion status. Check your connection and retry.', 'Retry']));
    await press(renderer, 'Retry');
    expect(mockRefetchDeletionStatus).toHaveBeenCalledTimes(1);
  });

  it('shows pending state and recovery window', async () => {
    mockDeletionStatus = { status: 'pending', recoveryWindowEndsAt: '2026-09-30T00:00:00.000Z' };
    const renderer = await renderScreen();
    expect(allText(renderer.root)).toEqual(expect.arrayContaining(['Account Deletion Pending', 'Cancel deletion']));
    expect(allText(renderer.root).join(' ')).toContain('Recovery Window Ends:');
    expect(allText(renderer.root)).not.toContain('Delete Account');
  });

  it('submits a normal typed request and logs out', async () => {
    const renderer = await renderScreen(); await submitTypedDeletion(renderer);
    expect(mockRequestDeletion).toHaveBeenCalledTimes(1); expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('warns active Premium members about continuing billing', async () => {
    mockMembershipActive = true;
    const renderer = await renderScreen();
    await press(renderer, 'Delete Account');
    expect(allText(renderer.root).join(' ')).toContain('Your Premium Membership may keep billing after account deletion.');
  });

  it('opens linked methods after stale authentication', async () => {
    mockRequestDeletion.mockRejectedValueOnce(new AccountDeletionApiError(401, 'stale', null, true));
    mockGetIdentities.mockResolvedValue([{ provider: 'email', email: 'player@example.com' }]);
    const renderer = await renderScreen(); await submitTypedDeletion(renderer);
    expect(allText(renderer.root)).toEqual(expect.arrayContaining(['Verify Your Identity', 'Email player@example.com']));
  });

  it.each([['Apple', 'apple-token'], ['Google', 'google-token']] as const)('uses linked %s and resumes deletion', async (label, token) => {
    mockRequestDeletion.mockRejectedValueOnce(new AccountDeletionApiError(401, 'stale', null, true)).mockResolvedValueOnce({ status: 'pending' });
    mockGetIdentities.mockResolvedValue([{ provider: label.toLowerCase(), email: null }]);
    const renderer = await renderScreen(); await submitTypedDeletion(renderer); await press(renderer, `Continue with ${label}`);
    expect(mockReauthenticateFirebase).toHaveBeenCalledWith(token); expect(mockRequestDeletion).toHaveBeenCalledTimes(2); expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('uses linked email and resumes deletion', async () => {
    mockRequestDeletion.mockRejectedValueOnce(new AccountDeletionApiError(401, 'stale', null, true)).mockResolvedValueOnce({ status: 'pending' });
    mockGetIdentities.mockResolvedValue([{ provider: 'email', email: 'player@example.com' }]);
    const renderer = await renderScreen(); await submitTypedDeletion(renderer); await press(renderer, 'Email player@example.com');
    expect(mockRequestEmailCode).toHaveBeenCalledWith('player@example.com');
    const input = renderer.root.findAllByType(TextInput).find((node) => node.props.placeholder === '000000');
    await act(async () => { input?.props.onChangeText('123456'); }); await press(renderer, 'Verify and Delete');
    expect(mockReauthenticateEmail).toHaveBeenCalledWith('player@example.com', '123456'); expect(mockRequestDeletion).toHaveBeenCalledTimes(2);
  });

  it('rejects a different account without resuming', async () => {
    mockRequestDeletion.mockRejectedValueOnce(new AccountDeletionApiError(401, 'stale', null, true));
    mockGetIdentities.mockResolvedValue([{ provider: 'google', email: 'other@example.com' }]);
    mockReauthenticateFirebase.mockRejectedValue(new AccountReauthenticationApiError(403, 'different_account', 'wrong'));
    const renderer = await renderScreen(); await submitTypedDeletion(renderer); await press(renderer, 'Continue with Google');
    expect(allText(renderer.root)).toContain('That sign-in belongs to a different account. Your current account was not changed.');
    expect(mockRequestDeletion).toHaveBeenCalledTimes(1); expect(mockLogout).not.toHaveBeenCalled();
  });
});
