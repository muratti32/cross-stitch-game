import {
  periodHasEntitlement,
  projectMembershipPeriod,
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
    accountId: ACCOUNT_ID,
    type: 'INITIAL_PURCHASE',
    productId: 'premium_monthly',
    periodType: 'NORMAL',
    eventAt: new Date('2026-07-01T00:00:01.000Z'),
    purchasedAt: new Date('2026-07-01T00:00:00.000Z'),
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    gracePeriodExpiresAt: null,
    cancelReason: null,
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

  it.each([
    ['premium_weekly', 3],
    ['premium_monthly', 15],
    ['premium_annual', 180],
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
