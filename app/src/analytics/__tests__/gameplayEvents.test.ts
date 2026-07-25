import { captureGameplayEvent } from '../gameplayEvents';
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
    await captureGameplayEvent('purchase_started', { product_kind: 'stitch_coin_pack' });
    await captureGameplayEvent('purchase_completed', { product_kind: 'stitch_coin_pack' });
    await captureGameplayEvent('purchase_cancelled', { product_kind: 'ai_credit_pack' });
    await captureGameplayEvent('purchase_failed', {
      product_kind: 'premium_membership',
      failure_stage: 'store',
    });

    expect(mockedDb.enqueueAnalyticsGameplayEvent).toHaveBeenCalledTimes(14);
    expect(mockedDb.enqueueAnalyticsGameplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: '72bb19f7-e78e-4b72-bc75-d761122a25df',
        kind: 'purchase_failed',
        payload: { product_kind: 'premium_membership', failure_stage: 'store' },
      }),
    );
  });

  it('swallows a queue write failure so analytics cannot fail the player action', async () => {
    mockedDb.enqueueAnalyticsGameplayEvent.mockRejectedValueOnce(new Error('disk unavailable'));

    await expect(
      captureGameplayEvent('purchase_completed', { product_kind: 'ai_credit_pack' }),
    ).resolves.toBeUndefined();
  });
});
