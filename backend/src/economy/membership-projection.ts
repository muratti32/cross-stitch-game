import { resolvePremiumProduct, type PremiumPlan } from './membership.constants';
import type { CommerceOwner } from './commerce-owner';

const PLAN_RANK: Readonly<Record<PremiumPlan, number>> = {
  weekly: 0,
  monthly: 1,
  annual: 2,
};

export type MembershipLifecycle =
  | 'trial'
  | 'active'
  | 'cancelled'
  | 'grace'
  | 'billing_retry'
  | 'paused'
  | 'expired'
  | 'refunded';

export interface VerifiedMembershipEvent {
  environment: 'sandbox' | 'production';
  providerEventId: string;
  providerTransactionId: string;
  originalTransactionId: string;
  owner: CommerceOwner;
  type: string;
  productId: string;
  periodType: string;
  eventAt: Date;
  purchasedAt: Date;
  expiresAt: Date | null;
  gracePeriodExpiresAt: Date | null;
  cancelReason: string | null;
  /**
   * The target product a PRODUCT_CHANGE names for a plan cross-grade or
   * downgrade. Null for every other event type and for a PRODUCT_CHANGE the
   * provider sent without one.
   */
  newProductId: string | null;
}

export interface MembershipPeriodProjection {
  owner: CommerceOwner;
  originalTransactionId: string;
  productId: string;
  plan: PremiumPlan;
  periodType: string;
  startsAt: Date;
  endsAt: Date | null;
  currentStatus: MembershipLifecycle;
  statusEventAt: Date;
  creditAmount: number;
  refunded: boolean;
}

const STATUS_PRIORITY: Readonly<Record<string, number>> = {
  INITIAL_PURCHASE: 10,
  PRODUCT_CHANGE: 20,
  SUBSCRIPTION_EXTENDED: 30,
  SUBSCRIPTION_PAUSED: 40,
  BILLING_ISSUE: 50,
  CANCELLATION: 60,
  UNCANCELLATION: 70,
  RENEWAL: 80,
  EXPIRATION: 90,
  REFUND: 100,
};

/**
 * Only a downgrade is deferred to the end of the paid period; an upgrade takes
 * effect at once. Both the projection of a scheduled change and the detection
 * of its eventual activation ask the same question, so they ask it here.
 */
export function isPremiumPlanDowngrade(source: PremiumPlan, target: PremiumPlan): boolean {
  return PLAN_RANK[target] < PLAN_RANK[source];
}

export interface MembershipScheduledChange {
  targetPlan: PremiumPlan;
  effectiveAt: Date;
}

/**
 * Represents an unactivated PRODUCT_CHANGE as a visible scheduled downgrade,
 * distinct from the short reconciliation window a direct upgrade goes through
 * (issue #124). Only a downgrade relative to the currently active plan
 * qualifies: an upgrade activates immediately through #123's in-app
 * confirmation and reconciliation path instead. `active.endsAt` already
 * having moved past the candidate's effective date means the active
 * subscription renewed on its original plan instead of the scheduled target —
 * the provider either never delivered the change or the player cancelled it
 * through Manage Subscription — so the candidate is stale rather than a
 * current scheduled change.
 */
export function projectScheduledChange(
  candidate: VerifiedMembershipEvent | undefined,
  active: { plan: PremiumPlan; endsAt: Date | null } | null,
): MembershipScheduledChange | null {
  if (candidate === undefined || active === null) return null;
  if (candidate.type !== 'PRODUCT_CHANGE' || candidate.newProductId === null) return null;
  const target = resolvePremiumProduct(candidate.newProductId);
  if (target === null) return null;
  if (!isPremiumPlanDowngrade(active.plan, target.plan)) return null;
  const effectiveAt = candidate.gracePeriodExpiresAt ?? candidate.expiresAt;
  if (effectiveAt === null) return null;
  if (active.endsAt !== null && active.endsAt.getTime() > effectiveAt.getTime()) return null;
  return { targetPlan: target.plan, effectiveAt };
}

export function isMembershipRefund(event: VerifiedMembershipEvent): boolean {
  return (
    event.type === 'REFUND' ||
    (event.type === 'CANCELLATION' && event.cancelReason === 'CUSTOMER_SUPPORT')
  );
}

export function projectMembershipPeriod(
  events: readonly VerifiedMembershipEvent[],
): MembershipPeriodProjection | null {
  if (events.length === 0) return null;

  const ordered = [...events].sort((left, right) => {
    const byTime = left.eventAt.getTime() - right.eventAt.getTime();
    if (byTime !== 0) return byTime;
    const byPriority = (STATUS_PRIORITY[left.type] ?? 0) - (STATUS_PRIORITY[right.type] ?? 0);
    if (byPriority !== 0) return byPriority;
    return left.providerEventId.localeCompare(right.providerEventId);
  });
  const latest = ordered[ordered.length - 1];
  // PRODUCT_CHANGE records change intent only (issue #123): it carries a new
  // provider_transaction_id (plan cross-grade/upgrade) and never anchors a
  // period on its own, so a bare PRODUCT_CHANGE history projects to nothing —
  // the current entitlement is left untouched until the provider reports the
  // effective paid period (RENEWAL on Apple, INITIAL_PURCHASE on Google Play).
  const purchase = ordered.find(
    (event) => event.type === 'INITIAL_PURCHASE' || event.type === 'RENEWAL',
  );
  if (!purchase) return null;

  const product = resolvePremiumProduct(purchase.productId);
  if (!product) return null;

  const trial = purchase.periodType === 'TRIAL';
  const refund = [...ordered].reverse().find((event) => isMembershipRefund(event));
  const latestIsRefund = refund !== undefined && refund.eventAt.getTime() >= latest.eventAt.getTime();
  const currentStatus = lifecycleForEvent(latest, trial, latestIsRefund);
  const endsAt = latest.gracePeriodExpiresAt ?? latest.expiresAt ?? purchase.expiresAt;

  return {
    owner: purchase.owner,
    originalTransactionId: purchase.originalTransactionId,
    productId: purchase.productId,
    plan: product.plan,
    periodType: purchase.periodType,
    startsAt: purchase.purchasedAt,
    endsAt,
    currentStatus,
    statusEventAt: latest.eventAt,
    creditAmount: trial ? 0 : product.creditsPerPaidPeriod,
    refunded: latestIsRefund,
  };
}

export function periodHasEntitlement(
  period: Pick<MembershipPeriodProjection, 'currentStatus' | 'endsAt'>,
  now: Date,
): boolean {
  if (period.endsAt === null || period.endsAt.getTime() <= now.getTime()) return false;
  return !['expired', 'refunded'].includes(period.currentStatus);
}

export function selectMembershipPeriod<T extends {
  currentStatus: MembershipLifecycle;
  endsAt: Date | null;
  statusEventAt: Date;
}>(periods: readonly T[], now: Date): T | undefined {
  const ordered = [...periods].sort((left, right) => {
    const leftEnd = left.endsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightEnd = right.endsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    return rightEnd - leftEnd || right.statusEventAt.getTime() - left.statusEventAt.getTime();
  });
  return ordered.find((period) => periodHasEntitlement(period, now)) ?? ordered[0];
}

function lifecycleForEvent(
  event: VerifiedMembershipEvent,
  trial: boolean,
  refunded: boolean,
): MembershipLifecycle {
  if (refunded) return 'refunded';
  switch (event.type) {
    case 'EXPIRATION':
      return 'expired';
    case 'BILLING_ISSUE':
      return event.gracePeriodExpiresAt !== null ? 'grace' : 'billing_retry';
    case 'CANCELLATION':
      return 'cancelled';
    case 'SUBSCRIPTION_PAUSED':
      return 'paused';
    default:
      return trial ? 'trial' : 'active';
  }
}
