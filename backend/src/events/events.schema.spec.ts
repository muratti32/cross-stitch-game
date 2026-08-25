import { BadRequestException } from '@nestjs/common';

import { validateGameplayEventPayload } from './events.schema';

describe('Gameplay event schema', () => {
  it('accepts a known kind with its exact valid fields', () => {
    expect(
      validateGameplayEventPayload('session_started', {
        session_id: '11111111-1111-4111-8111-111111111111',
      }),
    ).toEqual({
      kind: 'session_started',
      payload: { session_id: '11111111-1111-4111-8111-111111111111' },
    });
  });

  it('rejects an unknown kind', () => {
    expect(() => validateGameplayEventPayload('analytics_ping', {})).toThrow(
      BadRequestException,
    );
  });

  it('rejects unknown payload fields', () => {
    expect(() =>
      validateGameplayEventPayload('daily_task_completed', {
        task_key: 'cells_100',
        prompt: 'must never be stored',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects missing required payload fields', () => {
    expect(() =>
      validateGameplayEventPayload('purchase_failed', {
        product_kind: 'ai_credit_pack',
        product_key: 'ai_credit_pack_5',
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts Commerce Store source and closed product key payloads', () => {
    expect(validateGameplayEventPayload('commerce_store_viewed', {
      source: 'sign_in_return',
    })).toEqual({
      kind: 'commerce_store_viewed',
      payload: { source: 'sign_in_return' },
    });
    expect(validateGameplayEventPayload('commerce_product_selected', {
      product_kind: 'stitch_coin_pack',
      product_key: 'coin_pack_900',
    })).toEqual({
      kind: 'commerce_product_selected',
      payload: {
        product_kind: 'stitch_coin_pack',
        product_key: 'coin_pack_900',
      },
    });
  });

  it('accepts a canonical product the current offering did not return', () => {
    expect(validateGameplayEventPayload('commerce_catalog_incomplete', {
      product_kind: 'premium_membership',
      product_key: 'premium_weekly',
    })).toEqual({
      kind: 'commerce_catalog_incomplete',
      payload: {
        product_kind: 'premium_membership',
        product_key: 'premium_weekly',
      },
    });
  });

  it('rejects a raw store identifier on the catalog availability event', () => {
    expect(() => validateGameplayEventPayload('commerce_catalog_incomplete', {
      product_kind: 'premium_membership',
      product_key: 'com.avk.stitchwish.premium_weekly',
    })).toThrow(BadRequestException);
  });

  it('rejects a product key outside its documented product kind', () => {
    expect(() => validateGameplayEventPayload('commerce_product_selected', {
      product_kind: 'premium_membership',
      product_key: 'coin_pack_300',
    })).toThrow(BadRequestException);
  });

  it.each([
    'subscription_change_started',
    'subscription_change_completed',
    'subscription_change_cancelled',
  ] as const)('accepts a %s plan-change payload with no identifiers', (kind) => {
    const payload = {
      source_plan: 'premium_weekly',
      target_plan: 'premium_monthly',
      platform: 'ios',
    };
    expect(validateGameplayEventPayload(kind, payload)).toEqual({ kind, payload });
  });

  it('accepts subscription_change_failed with its failure stage', () => {
    const payload = {
      source_plan: 'premium_weekly',
      target_plan: 'premium_annual',
      platform: 'android',
      failure_stage: 'store',
    };
    expect(validateGameplayEventPayload('subscription_change_failed', payload)).toEqual({
      kind: 'subscription_change_failed',
      payload,
    });
  });

  it('rejects an unexpected failure_stage field on subscription_change_completed', () => {
    expect(() => validateGameplayEventPayload('subscription_change_completed', {
      source_plan: 'premium_weekly',
      target_plan: 'premium_monthly',
      platform: 'ios',
      failure_stage: 'store',
    })).toThrow(BadRequestException);
  });

  it('rejects a subscription_change payload carrying an account, subscriber, transaction, or Support Reference identifier', () => {
    expect(() => validateGameplayEventPayload('subscription_change_started', {
      source_plan: 'premium_weekly',
      target_plan: 'premium_monthly',
      platform: 'ios',
      account_id: '11111111-1111-4111-8111-111111111111',
    })).toThrow(BadRequestException);
  });

  it('rejects a one-time-pack product key on a subscription_change event', () => {
    expect(() => validateGameplayEventPayload('subscription_change_started', {
      source_plan: 'premium_weekly',
      target_plan: 'coin_pack_300',
      platform: 'ios',
    })).toThrow(BadRequestException);
  });

  it('rejects an unsupported subscription_change platform', () => {
    expect(() => validateGameplayEventPayload('subscription_change_started', {
      source_plan: 'premium_weekly',
      target_plan: 'premium_monthly',
      platform: 'web',
    })).toThrow(BadRequestException);
  });

  it('rejects subscription_change_failed missing its required failure_stage', () => {
    expect(() => validateGameplayEventPayload('subscription_change_failed', {
      source_plan: 'premium_weekly',
      target_plan: 'premium_monthly',
      platform: 'ios',
    })).toThrow(BadRequestException);
  });
});
