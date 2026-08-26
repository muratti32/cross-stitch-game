import { captureGameplayEvent, captureOnboardingEvent } from '../gameplayEvents';
import * as localDb from '../../local-db';

jest.mock('../../local-db', () => ({
  enqueueAnalyticsGameplayEvent: jest.fn(),
  generateUUID: jest.fn(() => '72bb19f7-e78e-4b72-bc75-d761122a25df'),
}));

const mockedDb = localDb as jest.Mocked<typeof localDb>;

describe('captureGameplayEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('durably queues documented session, Daily Task, conversion, generation, and purchase payloads', async () => {
    mockedDb.enqueueAnalyticsGameplayEvent.mockResolvedValue(undefined);

    await captureGameplayEvent('session_started', {
      session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5',
    });
    await captureGameplayEvent('session_completed', {
      session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5',
    });
    await captureGameplayEvent('daily_task_completed', { task_key: 'cells_100' });
    await captureGameplayEvent('pattern_conversion_started', {
      source_artwork_kind: 'photo_artwork',
      conversion_profile: 'easy',
    });
    await captureGameplayEvent('pattern_conversion_completed', {
      source_artwork_kind: 'ai_artwork',
    });
    await captureGameplayEvent('pattern_conversion_failed', {
      source_artwork_kind: 'photo_artwork',
      failure_stage: 'upload',
    });
    await captureGameplayEvent('ai_generation_started', { aspect: 'square' });
    await captureGameplayEvent('ai_generation_prompt_blocked', {});
    await captureGameplayEvent('ai_generation_completed', { aspect: 'portrait_4_3' });
    await captureGameplayEvent('ai_generation_failed', { failure_stage: 'delivery' });
    await captureGameplayEvent('commerce_store_viewed', { source: 'profile' });
    await captureGameplayEvent('commerce_product_selected', {
      product_kind: 'stitch_coin_pack',
      product_key: 'coin_pack_300',
    });
    await captureGameplayEvent('purchase_started', {
      product_kind: 'stitch_coin_pack',
      product_key: 'coin_pack_300',
    });
    await captureGameplayEvent('purchase_reconciliation_pending', {
      product_kind: 'stitch_coin_pack',
      product_key: 'coin_pack_300',
    });
    await captureGameplayEvent('purchase_completed', {
      product_kind: 'stitch_coin_pack',
      product_key: 'coin_pack_300',
    });
    await captureGameplayEvent('purchase_cancelled', {
      product_kind: 'ai_credit_pack',
      product_key: 'ai_credit_pack_5',
    });
    await captureGameplayEvent('purchase_failed', {
      product_kind: 'premium_membership',
      product_key: 'premium_monthly',
      failure_stage: 'store',
    });

    expect(mockedDb.enqueueAnalyticsGameplayEvent).toHaveBeenCalledTimes(17);
    expect(mockedDb.enqueueAnalyticsGameplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: '72bb19f7-e78e-4b72-bc75-d761122a25df',
        kind: 'purchase_failed',
        payload: {
          product_kind: 'premium_membership',
          product_key: 'premium_monthly',
          failure_stage: 'store',
        },
      }),
    );
  });

  it('swallows a queue write failure so analytics cannot fail the player action', async () => {
    mockedDb.enqueueAnalyticsGameplayEvent.mockRejectedValueOnce(new Error('disk unavailable'));

    await expect(
      captureGameplayEvent('purchase_completed', {
        product_kind: 'ai_credit_pack',
        product_key: 'ai_credit_pack_20',
      }),
    ).resolves.toBeUndefined();
  });

  it('adds onboarding version and preserves required dedupe keys', async () => {
    mockedDb.enqueueAnalyticsGameplayEvent.mockResolvedValue(undefined);
    await captureOnboardingEvent('onboarding_started', { is_resume: false }, 'onboarding_started');
    await captureOnboardingEvent('tutorial_beat_completed', {
      beat_id: 'stitch_action', elapsed_ms: 42, attempt_count: 1, auto_satisfied: false,
    }, 'tutorial_beat_completed:stitch_action');
    expect(mockedDb.enqueueAnalyticsGameplayEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      kind: 'onboarding_started', dedupeKey: 'onboarding_started', payload: { onboarding_version: '1', is_resume: false },
    }));
    expect(mockedDb.enqueueAnalyticsGameplayEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      kind: 'tutorial_beat_completed', dedupeKey: 'tutorial_beat_completed:stitch_action',
    }));
  });
});
