import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RegisteredAccountEntity, RegisteredAccountStatus } from '../auth/entities';
import { CommerceLedgerRepository } from './commerce-ledger.repository';
import { MembershipRepository } from './membership.repository';
import { resolvePremiumProduct } from './membership.constants';
import type { VerifiedMembershipEvent } from './membership-projection';

export interface RevenueCatWebhookOutcome {
  handled: boolean; // false for event types this ticket doesn't own
  detail: string; // short machine-readable reason for logging
}

@Injectable()
export class RevenueCatWebhookService {
  private readonly logger = new Logger(RevenueCatWebhookService.name);

  constructor(
    private readonly commerceLedger: CommerceLedgerRepository,
    private readonly membership: MembershipRepository,
    @InjectRepository(RegisteredAccountEntity)
    private readonly accounts: Repository<RegisteredAccountEntity>,
  ) {}

  async handleEvent(body: unknown): Promise<RevenueCatWebhookOutcome> {
    if (body === null || typeof body !== 'object') {
      throw new BadRequestException('Invalid webhook body shape');
    }

    const envelope = body as Record<string, unknown>;
    const event = envelope.event;
    if (event === null || typeof event !== 'object') {
      throw new BadRequestException('Webhook body is missing event object');
    }

    const evt = event as Record<string, unknown>;

    // Validate required event fields defensively
    const requiredFields = ['type', 'app_user_id', 'transaction_id', 'product_id', 'environment'];
    for (const field of requiredFields) {
      const value = evt[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new BadRequestException(`Event is missing or has invalid field: ${field}`);
      }
    }

    const type = evt.type as string;
    const appUserId = evt.app_user_id as string;
    const transactionId = evt.transaction_id as string;
    const productId = evt.product_id as string;
    const rawEnv = evt.environment as string;

    if (rawEnv !== 'SANDBOX' && rawEnv !== 'PRODUCTION') {
      throw new BadRequestException(`Invalid event environment value: ${rawEnv}`);
    }

    const environment = rawEnv.toLowerCase() as 'sandbox' | 'production';

    const account = await this.accounts.findOne({ where: { id: appUserId } });
    if (!account || account.status !== RegisteredAccountStatus.Active) {
      this.logger.warn(
        `RevenueCat webhook ${type} rejected: account ${appUserId} does not exist or is inactive`,
      );
      return { handled: false, detail: 'unknown_or_inactive_account' };
    }

    const premiumProduct = resolvePremiumProduct(productId);
    if (premiumProduct && MEMBERSHIP_EVENT_TYPES.has(type)) {
      const membershipEvent = parseMembershipEvent(evt, environment);
      if (
        membershipEvent.periodType === 'TRIAL' &&
        premiumProduct.plan !== 'monthly'
      ) {
        throw new BadRequestException('Only the Monthly Premium Plan may have a trial');
      }
      const result = await this.membership.recordVerifiedEvent(membershipEvent);
      if (result.rejectedOtherAccount) {
        this.logger.warn(
          `RevenueCat membership fraud signal: transaction ${transactionId} is bound to another account`,
        );
        return { handled: true, detail: 'rejected_other_account' };
      }
      this.logger.log(
        `RevenueCat membership ${type} transaction ${transactionId}: recorded=${result.recorded} granted=${result.creditGranted} reversed=${result.creditReversed}`,
      );
      return {
        handled: true,
        detail: result.recorded ? 'membership_event_recorded' : 'membership_event_replayed',
      };
    }

    if (type === 'NON_RENEWING_PURCHASE') {
      const result = await this.commerceLedger.processPurchase({
        environment,
        providerTransactionId: transactionId,
        accountId: appUserId,
        productId,
      });

      if (result.outcome === 'rejected_other_account') {
        this.logger.warn(
          `RevenueCat webhook NON_RENEWING_PURCHASE fraud signal: transaction ${transactionId} already bound to a different account (claimed by ${appUserId})`,
        );
      } else {
        this.logger.log(
          `RevenueCat webhook NON_RENEWING_PURCHASE transaction ${transactionId}: outcome=${result.outcome} currency=${result.currency} amount=${result.amount} balance=${result.balance}`,
        );
      }

      return {
        handled: true,
        detail: result.outcome,
      };
    }

    if (
      type === 'REFUND' ||
      (type === 'CANCELLATION' && evt.cancel_reason === 'CUSTOMER_SUPPORT')
    ) {
      const result = await this.commerceLedger.processReversal({
        environment,
        providerTransactionId: transactionId,
      });

      this.logger.log(
        `RevenueCat webhook REFUND transaction ${transactionId}: applied=${result.applied} currency=${result.currency} amount=${result.amount} balance=${result.balance}`,
      );

      return {
        handled: true,
        detail: result.applied ? 'reversed' : 'no_binding_to_reverse',
      };
    }

    this.logger.debug(`RevenueCat webhook ignored event type: ${type}`);
    return {
      handled: false,
      detail: 'ignored_event_type',
    };
  }
}

const MEMBERSHIP_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'CANCELLATION',
  'UNCANCELLATION',
  'SUBSCRIPTION_PAUSED',
  'EXPIRATION',
  'BILLING_ISSUE',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'REFUND',
]);

function parseMembershipEvent(
  event: Record<string, unknown>,
  environment: 'sandbox' | 'production',
): VerifiedMembershipEvent {
  const providerEventId = requiredString(event, 'id');
  const providerTransactionId = requiredString(event, 'transaction_id');
  const originalTransactionId = requiredString(event, 'original_transaction_id');
  const accountId = requiredString(event, 'app_user_id');
  const type = requiredString(event, 'type');
  const productId = requiredString(event, 'product_id');
  const periodType = requiredString(event, 'period_type');
  const eventAt = requiredTimestamp(event, 'event_timestamp_ms');
  const purchasedAt = requiredTimestamp(event, 'purchased_at_ms');
  const expiresAt = optionalTimestamp(event, 'expiration_at_ms');
  const gracePeriodExpiresAt = optionalTimestamp(
    event,
    'grace_period_expiration_at_ms',
  );
  const cancelReason =
    typeof event.cancel_reason === 'string' ? event.cancel_reason : null;

  return {
    environment,
    providerEventId,
    providerTransactionId,
    originalTransactionId,
    accountId,
    type,
    productId,
    periodType,
    eventAt,
    purchasedAt,
    expiresAt,
    gracePeriodExpiresAt,
    cancelReason,
  };
}

function requiredString(event: Record<string, unknown>, field: string): string {
  const value = event[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`Event is missing or has invalid field: ${field}`);
  }
  return value;
}

function requiredTimestamp(event: Record<string, unknown>, field: string): Date {
  const value = event[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException(`Event is missing or has invalid field: ${field}`);
  }
  return new Date(value);
}

function optionalTimestamp(
  event: Record<string, unknown>,
  field: string,
): Date | null {
  const value = event[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException(`Event has invalid field: ${field}`);
  }
  return new Date(value);
}
