import React from 'react';
import { Linking, Text } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { PromotionApiError } from '../../api/promotionContract';
import { WebLinks } from '../../config';
import { classifyPromotionFailure } from '../failure';
import type { PromotionHandoff } from '../handoff';
import { PromotionHandoffGate } from '../PromotionHandoffGate';
import { PromotionHandoffView, type PromotionHandoffViewProps } from '../PromotionHandoffView';
import type { PromotionFlowSnapshot, PromotionRunner } from '../promotionRunner';
import { ACCOUNT_ID, base, emptyManifest, preview } from './fixtures';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockIdentity = { accountId: null as string | null, isAuthenticated: false };
jest.mock('../../identity/guestIdentity', () => ({
  useIdentityStore: (selector: (state: typeof mockIdentity) => unknown) => selector(mockIdentity),
}));
jest.mock('../promotionRuntime', () => ({ promotionRunner: {} }));

function textValue(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return [value.flatMap(textValue).join('')];
  return [];
}

function allText(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).flatMap((node) => textValue(node.props.children));
}

function press(root: ReactTestInstance, text: string): void {
  const label = root.findAllByType(Text).find((node) => textValue(node.props.children).includes(text));
  if (!label) throw new Error(`Missing text: ${text}`);
  let current: ReactTestInstance | null = label;
  while (current && typeof current.props.onPress !== 'function') current = current.parent;
  if (!current) throw new Error('No pressable ancestor');
  current.props.onPress();
}

const actions = () => ({
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
  onRetry: jest.fn(),
  onContactSupport: jest.fn(),
});

function render(snapshot: PromotionFlowSnapshot, handlers: Partial<PromotionHandoffViewProps> = {}) {
  let renderer!: TestRenderer.ReactTestRenderer;
  const props = { ...actions(), ...handlers, snapshot };
  act(() => {
    renderer = TestRenderer.create(<PromotionHandoffView {...props} />);
  });
  return { root: renderer.root, text: () => allText(renderer.root), props };
}

const snap = (handoff: PromotionHandoff | null, failure: PromotionFlowSnapshot['failure'] = null): PromotionFlowSnapshot => ({
  handoff,
  failure,
});

const disclosing = (
  previewOverrides: Parameters<typeof preview>[0] = {},
  notice: 'stale' | null = null,
): PromotionHandoff => ({ ...base(), phase: 'disclosing', preview: preview(previewOverrides), notice });

describe('PromotionHandoffView', () => {
  test('renders nothing without a handoff', () => {
    expect(render(snap(null)).text()).toEqual([]);
  });

  test('previewing shows the checking state and lets the player cancel', () => {
    const view = render(snap({ ...base(), phase: 'previewing', notice: null }));

    expect(view.text()).toEqual(['Checking your Guest data…', 'Cancel']);
    press(view.root, 'Cancel');
    expect(view.props.onCancel).toHaveBeenCalledTimes(1);
  });

  test('economy disclosure lists what arrives and what does not, then confirms', () => {
    const view = render(
      snap(
        disclosing({
          guestLedgerBalance: 120,
          guestUnlockCount: 2,
          validatedPendingRewards: ['a', 'b', 'c'],
          pendingAdAttemptCount: 1,
          rejectedPendingRewards: { k: 'implausible_evidence' },
        }),
      ),
    );

    expect(view.text()).toEqual([
      'Bring your Guest data with you',
      'These will be added to your account:',
      'Stitch Coin balance: 120',
      'Unlocked patterns: 2',
      'Pending rewards: 3',
      'Ad rewards still verifying: 1. They will arrive on your account.',
      'Your stitching progress, completion history and Likes will move to your account.',
      'Will be discarded:',
      'Rewards that could not be verified: 1. They will not transfer.',
      'Cancelling signs you out of this account and returns you to your unchanged Guest session.',
      'Move my data',
      'Cancel',
    ]);
    press(view.root, 'Move my data');
    expect(view.props.onConfirm).toHaveBeenCalledTimes(1);
  });

  test('data-only disclosure lists everything given up and shows the stale notice', () => {
    const view = render(
      snap(
        disclosing(
          { promotionMode: 'data-only', guestLedgerBalance: 50, guestUnlockCount: 1, pendingAdAttemptCount: 2 },
          'stale',
        ),
      ),
    );

    expect(view.text()).toEqual([
      'Move your Guest progress',
      'Things changed while you were reviewing. Please check the details again before you continue.',
      'This account already received Guest Coins once, so only your progress, completion history and Likes will move. The Coins, Pattern Unlocks and pending rewards listed below will be discarded.',
      'Will be discarded:',
      'Stitch Coin balance: 50',
      'Unlocked patterns: 1',
      'Ad rewards still verifying: 2. They will not arrive.',
      'Cancelling signs you out of this account and returns you to your unchanged Guest session.',
      'Move my data',
      'Cancel',
    ]);
  });

  test('a disclosure with no progress to move omits the progress sentence', () => {
    const handoff: PromotionHandoff = { ...base({ manifest: emptyManifest() }), phase: 'disclosing', preview: preview(), notice: null };

    expect(render(snap(handoff)).text()).not.toContain(
      'Your stitching progress, completion history and Likes will move to your account.',
    );
  });

  test('committing before the commit step can still be cancelled', () => {
    const handoff: PromotionHandoff = { ...base(), phase: 'committing', preview: preview(), step: { kind: 'lock' } };

    expect(render(snap(handoff)).text()).toEqual([
      'Moving your Guest data to your account. Please keep the app open.',
      'Cancel',
    ]);
  });

  test('committing at the commit step offers no cancel', () => {
    const handoff: PromotionHandoff = { ...base(), phase: 'committing', preview: preview(), step: { kind: 'commit' } };

    expect(render(snap(handoff)).text()).toEqual([
      'Moving your Guest data to your account. Please keep the app open.',
    ]);
  });

  test.each([
    ['network', new TypeError('Network request failed'), "Can't reach the server. Check your connection and try again."],
    [
      'credentialRejected',
      new PromotionApiError(401, null, 'English prose'),
      "This device's Guest identity could not be verified, so your Guest data can't be moved right now.",
    ],
    [
      'guestNotFound',
      new PromotionApiError(404, null, 'English prose'),
      "Your Guest identity could not be found on the server, so there is nothing to move.",
    ],
    [
      'accountClosing',
      new PromotionApiError(403, null, 'English prose'),
      'This account is being deleted, so Guest data can\'t be moved to it.',
    ],
  ])('a %s failure shows its localized message with Retry and Cancel', (_name, error, message) => {
    const view = render(snap({ ...base(), phase: 'previewing', notice: null }, classifyPromotionFailure(error)));

    expect(view.text()).toEqual([message, 'Try again', 'Cancel']);
    press(view.root, 'Try again');
    expect(view.props.onRetry).toHaveBeenCalledTimes(1);
  });

  test('an unrecognized backend error shows the generic failure and never the server message', () => {
    const failure = classifyPromotionFailure(new PromotionApiError(500, 'something_new', 'Server English prose'));
    const view = render(snap({ ...base(), phase: 'previewing', notice: null }, failure));

    expect(view.text().join('\n')).not.toContain('Server English prose');
    expect(view.text()).toEqual([
      'Something went wrong. Please try again.\nSupport Reference: SW-00000000000000000000000000000000',
      'Try again',
      'Cancel',
    ]);
  });

  test('a failure at the commit step keeps Retry and drops Cancel', () => {
    const handoff: PromotionHandoff = { ...base(), phase: 'committing', preview: preview(), step: { kind: 'commit' } };
    const view = render(snap(handoff, classifyPromotionFailure(new TypeError('Network request failed'))));

    expect(view.text()).toEqual(["Can't reach the server. Check your connection and try again.", 'Try again']);
  });

  test('syncing shows a quiet indicator without any action', () => {
    const handoff: PromotionHandoff = {
      ...base(),
      phase: 'syncing',
      promotionMode: 'economy',
      acked: { likes: [], sessions: [] },
    };
    const view = render(snap(handoff));

    expect(view.text()).toEqual(['Syncing your Guest data…']);
    expect(view.root.findAllByType(require('react-native').Modal)).toHaveLength(0);
  });

  test('needs attention shows a banner with Retry and Contact support', () => {
    const handoff: PromotionHandoff = {
      ...base(),
      phase: 'needsAttention',
      promotionMode: 'data-only',
      acked: { likes: [], sessions: [] },
    };
    const view = render(snap(handoff));

    expect(view.text()).toEqual([
      'Some Guest data still needs attention',
      "Your account is ready to use. A few items haven't finished moving, and they are kept safe until they do.",
      'Try again',
      'Contact support',
    ]);
    press(view.root, 'Try again');
    press(view.root, 'Contact support');
    expect(view.props.onRetry).toHaveBeenCalledTimes(1);
    expect(view.props.onContactSupport).toHaveBeenCalledTimes(1);
  });
});

function fakeRunner(snapshot: PromotionFlowSnapshot): PromotionRunner {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    resume: jest.fn().mockResolvedValue(undefined),
    confirm: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(undefined),
    retry: jest.fn().mockResolvedValue(undefined),
  };
}

describe('PromotionHandoffGate', () => {
  beforeEach(() => {
    mockIdentity = { accountId: null, isAuthenticated: false };
  });

  function mount(runner: PromotionRunner) {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<PromotionHandoffGate runner={runner} />);
    });
    return renderer;
  }

  test('resumes the stored handoff once the account is signed in', () => {
    mockIdentity = { accountId: ACCOUNT_ID, isAuthenticated: true };
    const runner = fakeRunner(snap(null));

    mount(runner);

    expect(runner.resume).toHaveBeenCalledWith(ACCOUNT_ID);
  });

  test('does not resume for a Guest or before the account session is authenticated', () => {
    const runner = fakeRunner(snap(null));

    mount(runner);
    mockIdentity = { accountId: ACCOUNT_ID, isAuthenticated: false };
    mount(runner);

    expect(runner.resume).not.toHaveBeenCalled();
  });

  test('routes the buttons to the runner and Contact support to the support page', () => {
    mockIdentity = { accountId: ACCOUNT_ID, isAuthenticated: true };
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const runner = fakeRunner(snap(disclosing()));
    const renderer = mount(runner);

    press(renderer.root, 'Move my data');
    press(renderer.root, 'Cancel');

    expect(runner.confirm).toHaveBeenCalledTimes(1);
    expect(runner.cancel).toHaveBeenCalledTimes(1);

    const attention: PromotionHandoff = {
      ...base(),
      phase: 'needsAttention',
      promotionMode: 'economy',
      acked: { likes: [], sessions: [] },
    };
    const banner = mount(fakeRunner(snap(attention)));
    press(banner.root, 'Contact support');
    expect(openURL).toHaveBeenCalledWith(WebLinks.support);
    openURL.mockRestore();
  });
});

