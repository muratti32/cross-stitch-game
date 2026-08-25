import {
  periodHasEntitlement,
  projectMembershipPeriod,
  projectScheduledChange,
  selectMembershipPeriod,
  type VerifiedMembershipEvent,
} from './membership-projection';
import { premiumDailyClaimAmount } from './membership.constants';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function membershipEvent(
  overrides: Partial<VerifiedMembershipEvent> = {},
): VerifiedMembershipEvent {
  return {
    environment: 'sandbox',
    providerEventId: 'event-1',
    providerTransactionId: 'transaction-1',
    originalTransactionId: 'original-1',
    owner: { type: 'account', accountId: ACCOUNT_ID },
    type: 'INITIAL_PURCHASE',
    productId: 'com.avk.stitchwish.premium_monthly',
    periodType: 'NORMAL',
    eventAt: new Date('2026-07-01T00:00:01.000Z'),
    purchasedAt: new Date('2026-07-01T00:00:00.000Z'),
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    gracePeriodExpiresAt: null,
    cancelReason: null,
    newProductId: null,
    ...overrides,
  };
}

describe('membership period projection', () => {
  it('grants no credit for a Monthly trial while retaining entitlement', () => {
    const projection = projectMembershipPeriod([
      membershipEvent({
        periodType: 'TRIAL',
        expiresAt: new Date('2026-07-08T00:00:00.000Z'),
      }),
    ]);

    expect(projection).toMatchObject({
      plan: 'monthly',
      currentStatus: 'trial',
      creditAmount: 0,
    });
    expect(periodHasEntitlement(projection!, new Date('2026-07-04T00:00:00.000Z'))).toBe(true);
  });

  it('preserves a Guest Installation Identity owner through projection', () => {
    const owner = { type: 'guest' as const, guestInstallationId: '22222222-2222-4222-8222-222222222222' };
    expect(projectMembershipPeriod([membershipEvent({ owner })])).toMatchObject({ owner });
  });

  it.each([
    ['com.avk.stitchwish.premium_weekly', 3],
    ['com.avk.stitchwish.premium_monthly', 15],
    ['com.avk.stitchwish.premium_annual', 180],
  ])('maps %s to one paid-period credit grant', (productId, creditAmount) => {
    expect(projectMembershipPeriod([membershipEvent({ productId })])).toMatchObject({
      creditAmount,
    });
  });

  it('uses provider event time rather than webhook arrival order', () => {
    const expiration = membershipEvent({
      providerEventId: 'expiration',
      type: 'EXPIRATION',
      eventAt: new Date('2026-07-03T00:00:00.000Z'),
    });
    const recovery = membershipEvent({
      providerEventId: 'recovery',
      type: 'RENEWAL',
      eventAt: new Date('2026-07-04T00:00:00.000Z'),
      expiresAt: new Date('2026-08-04T00:00:00.000Z'),
    });

    const projection = projectMembershipPeriod([recovery, expiration]);

    expect(projection).toMatchObject({
      currentStatus: 'active',
      endsAt: new Date('2026-08-04T00:00:00.000Z'),
    });
  });

  it('keeps a newer valid period active when an older period is refunded', () => {
    const now = new Date('2026-07-20T00:00:00.000Z');
    const olderRefunded = {
      currentStatus: 'refunded' as const,
      endsAt: new Date('2026-08-01T00:00:00.000Z'),
      statusEventAt: new Date('2026-07-19T00:00:00.000Z'),
      transactionId: 'old',
    };
    const newerActive = {
      currentStatus: 'active' as const,
      endsAt: new Date('2026-08-20T00:00:00.000Z'),
      statusEventAt: new Date('2026-07-18T00:00:00.000Z'),
      transactionId: 'new',
    };

    expect(selectMembershipPeriod([olderRefunded, newerActive], now)).toBe(newerActive);
  });

  it('treats billing issue grace as active until the provider grace end', () => {
    const projection = projectMembershipPeriod([
      membershipEvent(),
      membershipEvent({
        providerEventId: 'billing-issue',
        type: 'BILLING_ISSUE',
        eventAt: new Date('2026-08-01T00:00:01.000Z'),
        gracePeriodExpiresAt: new Date('2026-08-08T00:00:00.000Z'),
      }),
    ]);

    expect(projection?.currentStatus).toBe('grace');
    expect(periodHasEntitlement(projection!, new Date('2026-08-04T00:00:00.000Z'))).toBe(true);
    expect(periodHasEntitlement(projection!, new Date('2026-08-09T00:00:00.000Z'))).toBe(false);
  });

  it('does not anchor a period on a lone PRODUCT_CHANGE event (issue #123: intent only, never activation)', () => {
    // PRODUCT_CHANGE carries a new provider_transaction_id (plan cross-grade or
    // upgrade); its own event history never contains an INITIAL_PURCHASE or
    // RENEWAL row. It must not create a target Membership Period grant on its
    // own — activation only happens once the provider reports the effective
    // paid period (RENEWAL on Apple, INITIAL_PURCHASE on Google Play).
    const projection = projectMembershipPeriod([
      membershipEvent({
        providerEventId: 'product-change-1',
        providerTransactionId: 'transaction-2',
        type: 'PRODUCT_CHANGE',
        productId: 'com.avk.stitchwish.premium_annual',
        eventAt: new Date('2026-08-01T00:00:01.000Z'),
        purchasedAt: new Date('2026-08-01T00:00:00.000Z'),
        expiresAt: new Date('2027-08-01T00:00:00.000Z'),
      }),
    ]);

    expect(projection).toBeNull();
  });

  it('anchors a period once the effective RENEWAL for the changed plan is delivered', () => {
    const projection = projectMembershipPeriod([
      membershipEvent({
        providerEventId: 'product-change-1',
        providerTransactionId: 'transaction-2',
        type: 'PRODUCT_CHANGE',
        productId: 'com.avk.stitchwish.premium_annual',
        eventAt: new Date('2026-08-01T00:00:01.000Z'),
        purchasedAt: new Date('2026-08-01T00:00:00.000Z'),
        expiresAt: new Date('2027-08-01T00:00:00.000Z'),
      }),
      membershipEvent({
        providerEventId: 'renewal-1',
        providerTransactionId: 'transaction-2',
        type: 'RENEWAL',
        productId: 'com.avk.stitchwish.premium_annual',
        eventAt: new Date('2026-08-01T00:00:02.000Z'),
        purchasedAt: new Date('2026-08-01T00:00:01.000Z'),
        expiresAt: new Date('2027-08-01T00:00:00.000Z'),
      }),
    ]);

    expect(projection).toMatchObject({
      plan: 'annual',
      currentStatus: 'active',
      creditAmount: 180,
    });
    expect(periodHasEntitlement(projection!, new Date('2026-08-04T00:00:00.000Z'))).toBe(true);
  });
});

describe('scheduled Premium Plan change projection (issue #124)', () => {
  const active = { plan: 'annual' as const, endsAt: new Date('2027-07-01T00:00:00.000Z') };

  it('returns null when there is no candidate PRODUCT_CHANGE', () => {
    expect(projectScheduledChange(undefined, active)).toBeNull();
  });

  it('surfaces a downgrade target with its provider effective-date evidence', () => {
    const candidate = membershipEvent({
      type: 'PRODUCT_CHANGE',
      newProductId: 'com.avk.stitchwish.premium_monthly',
      expiresAt: new Date('2027-07-01T00:00:00.000Z'),
    });

    expect(projectScheduledChange(candidate, active)).toEqual({
      targetPlan: 'monthly',
      effectiveAt: new Date('2027-07-01T00:00:00.000Z'),
    });
  });

  it('ignores an upgrade candidate: upgrades activate immediately, not as a scheduled change', () => {
    const candidate = membershipEvent({
      type: 'PRODUCT_CHANGE',
      newProductId: 'com.avk.stitchwish.premium_annual',
      expiresAt: new Date('2027-07-01T00:00:00.000Z'),
    });

    expect(projectScheduledChange(candidate, { plan: 'weekly', endsAt: null })).toBeNull();
  });

  it('ignores a non-PRODUCT_CHANGE event', () => {
    const candidate = membershipEvent({
      type: 'RENEWAL',
      newProductId: 'com.avk.stitchwish.premium_weekly',
      expiresAt: new Date('2027-07-01T00:00:00.000Z'),
    });

    expect(projectScheduledChange(candidate, active)).toBeNull();
  });

  it('withholds the change until the provider effective-date evidence arrives', () => {
    const candidate = membershipEvent({
      type: 'PRODUCT_CHANGE',
      newProductId: 'com.avk.stitchwish.premium_monthly',
      expiresAt: null,
      gracePeriodExpiresAt: null,
    });

    expect(projectScheduledChange(candidate, active)).toBeNull();
  });

  it('treats a stale candidate as cleared once the active period renewed past its effective date', () => {
    // The active subscription renewed on its original plan beyond the
    // candidate's effective date, so the provider never carried out the
    // downgrade (delivery never arrived, or it was cancelled).
    const candidate = membershipEvent({
      type: 'PRODUCT_CHANGE',
      newProductId: 'com.avk.stitchwish.premium_monthly',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    });

    expect(projectScheduledChange(candidate, active)).toBeNull();
  });
});

describe('Premium Daily Coin Claim', () => {
  it.each([
    [0, 30],
    [10, 20],
    [20, 10],
    [30, 0],
  ])('grants the remaining shared pool after %i ad Coin', (coinsConsumed, expected) => {
    expect(premiumDailyClaimAmount(coinsConsumed, false)).toBe(expected);
  });

  it('grants zero after the claim has closed the pool', () => {
    expect(premiumDailyClaimAmount(0, true)).toBe(0);
  });
});
