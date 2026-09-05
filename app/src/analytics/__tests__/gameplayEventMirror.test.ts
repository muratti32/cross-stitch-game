import {
  logEvent,
  logScreenView,
  setAnalyticsCollectionEnabled,
  setUserId,
  setUserProperty,
} from '@react-native-firebase/analytics';

import { captureGameplayEvent } from '../gameplayEvents';
import {
  applyAnalyticsMirrorConsent,
  mirrorScreenView,
  setAnalyticsMirrorPlayerReference,
  setAnalyticsMirrorUserProperties,
  __resetAnalyticsMirrorGlobals,
} from '../analyticsMirror';
import * as localDb from '../../local-db';
import { captureAnalyticsMirrorError } from '../../observability/sentry';

jest.mock('../../local-db', () => ({
  enqueueAnalyticsGameplayEvent: jest.fn(),
  generateUUID: jest.fn(() => '72bb19f7-e78e-4b72-bc75-d761122a25df'),
}));

jest.mock('../../observability/sentry', () => ({
  captureAnalyticsMirrorError: jest.fn(),
}));

const mockedDb = localDb as jest.Mocked<typeof localDb>;
const mockedCaptureAnalyticsMirrorError = captureAnalyticsMirrorError as jest.Mock;
// The SDK is modular: every call receives the Analytics instance first, which
// these assertions skip over - it carries no product meaning.
const mockedLogEvent = logEvent as unknown as jest.Mock;
const mockedLogScreenView = logScreenView as unknown as jest.Mock;
const mockedSetCollectionEnabled = setAnalyticsCollectionEnabled as unknown as jest.Mock;
const mockedSetUserId = setUserId as unknown as jest.Mock;
const mockedSetUserProperty = setUserProperty as unknown as jest.Mock;
const bridge = {
  logEvent: mockedLogEvent,
  logScreenView: mockedLogScreenView,
  setAnalyticsCollectionEnabled: mockedSetCollectionEnabled,
};
const loggedEvents = (): unknown[][] =>
  mockedLogEvent.mock.calls.map(([, name, params]) => [name, params]);
const lastCollectionEnabled = (): unknown =>
  mockedSetCollectionEnabled.mock.calls.at(-1)?.[1];

/**
 * ADR-0055. Every assertion drives the real capture path a player action would
 * take - `captureGameplayEvent` - and observes what reaches the analytics SDK.
 * The mirror module is deliberately never called directly, so it stays free to
 * change shape as long as the events leaving the device do not.
 */
describe('Analytics Mirror through captureGameplayEvent', () => {
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetAnalyticsMirrorGlobals();
    mockedDb.enqueueAnalyticsGameplayEvent.mockResolvedValue(undefined);
    // A production build; development collection is exercised separately below.
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  });

  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  it('mirrors allow-listed funnel events under prefixed names with their first-party payloads', async () => {
    applyAnalyticsMirrorConsent(true);

    await captureGameplayEvent('session_started', {
      session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5',
    });
    await captureGameplayEvent('daily_task_completed', { task_key: 'cells_100' });
    await captureGameplayEvent('ai_generation_failed', { failure_stage: 'delivery' });
    await captureGameplayEvent('commerce_store_viewed', { source: 'profile' });
    await captureGameplayEvent('onboarding_finished', {
      onboarding_version: '1',
      outcome: 'completed',
      destination: 'catalog',
      duration_ms: 61_000,
      stitch_count: 42,
    });

    expect(loggedEvents()).toEqual([
      ['sw_session_started', { session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5' }],
      ['sw_daily_task_completed', { task_key: 'cells_100' }],
      ['sw_ai_generation_failed', { failure_stage: 'delivery' }],
      ['sw_commerce_store_viewed', { source: 'profile' }],
      [
        'sw_onboarding_finished',
        {
          onboarding_version: '1',
          outcome: 'completed',
          destination: 'catalog',
          duration_ms: 61_000,
          stitch_count: 42,
        },
      ],
    ]);
  });

  it('keeps diagnostic and mid-funnel events out of the mirror while still queueing them first-party', async () => {
    applyAnalyticsMirrorConsent(true);

    await captureGameplayEvent('tutorial_beat_started', {
      onboarding_version: '1',
      beat_id: 'first_stitch',
      beat_number: 1,
    });
    await captureGameplayEvent('onboarding_step_viewed', {
      onboarding_version: '1',
      step: 'welcome',
      is_resume: false,
    });
    await captureGameplayEvent('purchase_cancelled', {
      product_kind: 'stitch_coin_pack',
      product_key: 'coin_pack_300',
    });
    await captureGameplayEvent('commerce_catalog_incomplete', {
      product_kind: 'ai_credit_pack',
      product_key: 'ai_credit_pack_5',
    });
    await captureGameplayEvent('subscription_change_completed', {
      source_plan: 'premium_monthly',
      target_plan: 'premium_annual',
      platform: 'ios',
    });

    expect(bridge.logEvent).not.toHaveBeenCalled();
    expect(mockedDb.enqueueAnalyticsGameplayEvent).toHaveBeenCalledTimes(5);
  });

  it('reports a completed purchase as GA4 purchase with the full revenue schema, none of which reaches the backend', async () => {
    applyAnalyticsMirrorConsent(true);

    await captureGameplayEvent(
      'purchase_completed',
      { product_kind: 'stitch_coin_pack', product_key: 'coin_pack_300' },
      undefined,
      {
        currency: 'USD',
        items: [
          {
            item_category: 'stitch_coin_pack',
            item_id: 'coin_pack_300',
            price: 4.99,
            quantity: 1,
          },
        ],
        transactionId: 'store-txn-1',
        value: 4.99,
      },
    );

    expect(bridge.logEvent).toHaveBeenCalledWith(expect.anything(), 'purchase', {
      currency: 'USD',
      items: [
        {
          item_category: 'stitch_coin_pack',
          item_id: 'coin_pack_300',
          price: 4.99,
          quantity: 1,
        },
      ],
      product_kind: 'stitch_coin_pack',
      product_key: 'coin_pack_300',
      transaction_id: 'store-txn-1',
      value: 4.99,
    });
    expect(mockedDb.enqueueAnalyticsGameplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'purchase_completed',
        payload: { product_kind: 'stitch_coin_pack', product_key: 'coin_pack_300' },
      }),
    );
  });

  it('mirrors a purchase without inventing an amount when the store reported no price', async () => {
    applyAnalyticsMirrorConsent(true);

    await captureGameplayEvent('purchase_completed', {
      product_kind: 'premium_membership',
      product_key: 'premium_annual',
    });

    expect(bridge.logEvent).toHaveBeenCalledWith(expect.anything(), 'purchase', {
      product_kind: 'premium_membership',
      product_key: 'premium_annual',
    });
  });

  it('sends nothing before consent is granted, and starts sending once it is', async () => {
    await captureGameplayEvent('session_started', {
      session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5',
    });
    expect(bridge.logEvent).not.toHaveBeenCalled();

    applyAnalyticsMirrorConsent(true);
    await captureGameplayEvent('session_completed', {
      session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5',
    });

    expect(lastCollectionEnabled()).toBe(true);
    expect(bridge.logEvent).toHaveBeenCalledTimes(1);
    expect(bridge.logEvent).toHaveBeenCalledWith(
      expect.anything(),
      'sw_session_completed',
      expect.anything(),
    );
  });

  it('stays silent for a player who declined consent', async () => {
    applyAnalyticsMirrorConsent(false);

    await captureGameplayEvent('session_started', {
      session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5',
    });

    expect(lastCollectionEnabled()).toBe(false);
    expect(bridge.logEvent).not.toHaveBeenCalled();
  });

  it('collects nothing in a development build unless that device opts in', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    applyAnalyticsMirrorConsent(true);

    await captureGameplayEvent('session_started', {
      session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5',
    });

    expect(bridge.logEvent).not.toHaveBeenCalled();
  });

  it('keeps the first-party enqueue intact and never throws when the SDK fails', async () => {
    applyAnalyticsMirrorConsent(true);
    bridge.logEvent.mockRejectedValueOnce(new Error('native module exploded'));

    await expect(
      captureGameplayEvent('session_started', {
        session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5',
      }),
    ).resolves.toBeUndefined();

    expect(mockedDb.enqueueAnalyticsGameplayEvent).toHaveBeenCalledTimes(1);
  });

  it('still mirrors when the first-party enqueue fails, so one failure cannot hide the other', async () => {
    applyAnalyticsMirrorConsent(true);
    mockedDb.enqueueAnalyticsGameplayEvent.mockRejectedValueOnce(new Error('sqlite is full'));

    await captureGameplayEvent('session_started', {
      session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5',
    });

    expect(bridge.logEvent).toHaveBeenCalledWith(
      expect.anything(),
      'sw_session_started',
      expect.anything(),
    );
  });

  // Identity is learned at startup, before the consent flow settles, so the
  // transition itself is what these cover.
  describe('identity across the consent transition', () => {
    const properties = {
      app_language: 'tr',
      is_guest: 'true',
      membership_tier: 'free',
    } as const;

    it('applies the reference and properties learned before consent, once consent arrives', async () => {
      setAnalyticsMirrorPlayerReference('opaque-player-1');
      setAnalyticsMirrorUserProperties(properties);
      expect(mockedSetUserId).not.toHaveBeenCalled();
      expect(mockedSetUserProperty).not.toHaveBeenCalled();

      applyAnalyticsMirrorConsent(true);

      expect(mockedSetUserId).toHaveBeenCalledWith(expect.anything(), 'opaque-player-1');
      expect(mockedSetUserProperty.mock.calls.map(([, name, value]) => [name, value])).toEqual([
        ['app_language', 'tr'],
        ['is_guest', 'true'],
        ['membership_tier', 'free'],
      ]);

      await captureGameplayEvent('session_started', {
        session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5',
      });
      expect(bridge.logEvent).toHaveBeenCalledTimes(1);
    });

    it('applies nothing on a declined consent, and keeps the reference for a later grant', () => {
      setAnalyticsMirrorPlayerReference('opaque-player-2');

      applyAnalyticsMirrorConsent(false);
      expect(mockedSetUserId).not.toHaveBeenCalled();

      applyAnalyticsMirrorConsent(true);
      expect(mockedSetUserId).toHaveBeenCalledWith(expect.anything(), 'opaque-player-2');
    });

    it('clears the reference on sign-out after consent, without waiting for another grant', () => {
      applyAnalyticsMirrorConsent(true);
      setAnalyticsMirrorPlayerReference('opaque-player-3');
      mockedSetUserId.mockClear();

      setAnalyticsMirrorPlayerReference(null);

      expect(mockedSetUserId).toHaveBeenCalledWith(expect.anything(), null);
    });
  });

  // The one entry point exercised directly: driving it through the router
  // would test expo-router, not what leaves the device.
  describe('screen views', () => {
    it('logs the route template and never a route parameter value', () => {
      applyAnalyticsMirrorConsent(true);

      mirrorScreenView('(tabs)/(play)/[sessionId]');

      expect(bridge.logScreenView).toHaveBeenCalledWith(expect.anything(), {
        screen_class: '(tabs)/(play)/[sessionId]',
        screen_name: '(tabs)/(play)/[sessionId]',
      });
    });

    it('logs nothing before consent is granted', () => {
      mirrorScreenView('(tabs)/(catalog)');

      expect(bridge.logScreenView).not.toHaveBeenCalled();
    });
  });

  // STITCH-WISH-S: the modular `logEvent` returns nothing, so a mirror that
  // assumed a promise threw on every mirrored event - inside the path whose
  // whole purpose is to keep analytics failures away from play.
  describe('SDK helpers that return no promise', () => {
    it('mirrors an event when logEvent returns undefined, without throwing', async () => {
      mockedLogEvent.mockReturnValue(undefined);
      applyAnalyticsMirrorConsent(true);

      await expect(
        captureGameplayEvent('session_started', {
          session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5',
        }),
      ).resolves.not.toThrow();

      expect(loggedEvents()).toEqual([
        ['sw_session_started', { session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5' }],
      ]);
    });

    it('still reports a throwing SDK call to Sentry', async () => {
      mockedLogEvent.mockImplementation(() => {
        throw new Error('native module unavailable');
      });
      applyAnalyticsMirrorConsent(true);

      await captureGameplayEvent('session_started', {
        session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5',
      });

      expect(mockedCaptureAnalyticsMirrorError).toHaveBeenCalledWith(
        'log-event',
        expect.any(Error),
      );
    });
  });
});
