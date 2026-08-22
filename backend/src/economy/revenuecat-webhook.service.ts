import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { RegisteredAccountEntity, RegisteredAccountStatus } from '../auth/entities';
import { CommerceLedgerRepository } from './commerce-ledger.repository';
import { MembershipRepository } from './membership.repository';
import { resolvePremiumProduct } from './membership.constants';
import type { VerifiedMembershipEvent } from './membership-projection';
import { GuestPurchaseAttemptService } from './guest-purchase-attempt.service';

export interface RevenueCatWebhookOutcome {
  handled: boolean; // false for event types this ticket doesn't own
  detail: string; // short machine-readable reason for logging
  duplicate: boolean;
}

@Injectable()
export class RevenueCatWebhookService {
  private readonly logger = new Logger(RevenueCatWebhookService.name);

  constructor(
    private readonly commerceLedger: CommerceLedgerRepository,
    private readonly membership: MembershipRepository,
    @InjectRepository(RegisteredAccountEntity)
    private readonly accounts: Repository<RegisteredAccountEntity>,
    @Optional() private readonly guestAttempts?: GuestPurchaseAttemptService,
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

    // Validate the fields every event kind carries. TRANSFER is the exception to
    // the rest: it describes a subscriber identity move, so it has no
    // app_user_id, transaction_id or product_id of its own.
    for (const field of ['type', 'environment']) {
      const value = evt[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new BadRequestException(`Event is missing or has invalid field: ${field}`);
      }
    }

    const type = evt.type as string;
    const rawEnv = evt.environment as string;

    if (rawEnv !== 'SANDBOX' && rawEnv !== 'PRODUCTION') {
      throw new BadRequestException(`Invalid event environment value: ${rawEnv}`);
    }

    const environment = rawEnv.toLowerCase() as 'sandbox' | 'production';

    if (type === 'TRANSFER') {
      return this.handleTransfer(evt, environment);
    }

    for (const field of ['app_user_id', 'transaction_id', 'product_id']) {
      const value = evt[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new BadRequestException(`Event is missing or has invalid field: ${field}`);
      }
    }

    const appUserId = evt.app_user_id as string;
    const transactionId = evt.transaction_id as string;
    const productId = evt.product_id as string;
    const account = UUID_PATTERN.test(appUserId)
      ? await this.accounts.findOne({ where: { id: appUserId } })
      : null;

    if (type === 'NON_RENEWING_PURCHASE') {
      if (account && account.status === RegisteredAccountStatus.Active) {
        return this.applyAccountPurchase(account.id, productId, environment, transactionId);
      }
      const aliases = Array.isArray(evt.aliases)
        ? evt.aliases.filter((value): value is string => typeof value === 'string')
        : [];
      const originalAppUserId = typeof evt.original_app_user_id === 'string'
        ? [evt.original_app_user_id]
        : [];
      const guestResult = this.guestAttempts === undefined ? null : await this.guestAttempts.applyWebhook(
        [appUserId, ...aliases, ...originalAppUserId],
        productId,
        environment,
        transactionId,
      );
      if (guestResult !== null) return guestResult;
    }

    if (!account || account.status !== RegisteredAccountStatus.Active) {
      this.logger.warn(
        `RevenueCat webhook ${type} rejected: account ${appUserId} does not exist or is inactive`,
      );
      return { handled: false, detail: 'unknown_or_inactive_account', duplicate: false };
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
        return { handled: true, detail: 'rejected_other_account', duplicate: false };
      }
      this.logger.log(
        `RevenueCat membership ${type} transaction ${transactionId}: recorded=${result.recorded} granted=${result.creditGranted} reversed=${result.creditReversed}`,
      );
      return {
        handled: true,
        detail: result.recorded ? 'membership_event_recorded' : 'membership_event_replayed',
        duplicate: !result.recorded,
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
        duplicate: result.outcome === 'replayed_same_account',
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
        duplicate: !result.applied,
      };
    }

    this.logger.debug(`RevenueCat webhook ignored event type: ${type}`);
    return {
      handled: false,
      detail: 'ignored_event_type',
      duplicate: false,
    };
  }

  private async applyAccountPurchase(accountId: string, productId: string, environment: 'sandbox' | 'production', transactionId: string): Promise<RevenueCatWebhookOutcome> {
    const result = await this.commerceLedger.processPurchase({ environment, providerTransactionId: transactionId, accountId, productId });
    return { handled: true, detail: result.outcome, duplicate: result.outcome === 'replayed_same_account' };
  }

  /**
   * A store account keeps its subscription when the player signs in with a
   * different Registered Account, and RevenueCat reports that as TRANSFER.
   * Without this, the Membership Periods stay on the previous account and every
   * later event for the same provider transaction trips the ownership guard in
   * MembershipRepository.recordVerifiedEvent, so the new account can never see
   * the entitlement it is paying for (ADR-0032).
   *
   * Only Membership state moves. Stitch Coin and AI Credit grants for one-time
   * purchases were already delivered to the previous account and are not
   * clawed back, and the Membership Credit Grant for a period keys on the
   * provider transaction rather than the account, so a transfer never regrants.
   */
  private async handleTransfer(
    event: Record<string, unknown>,
    environment: 'sandbox' | 'production',
  ): Promise<RevenueCatWebhookOutcome> {
    const transferredTo = appUserIdList(event, 'transferred_to');
    const transferredFrom = appUserIdList(event, 'transferred_from');

    const targets = await this.activeAccountIds(transferredTo);
    if (targets.length !== 1) {
      this.logger.warn(
        `RevenueCat webhook TRANSFER rejected: transferred_to resolves to ${targets.length} active accounts`,
      );
      return { handled: false, detail: 'transfer_target_unresolved', duplicate: false };
    }
    const toAccountId = targets[0];
    const fromAccountIds = transferredFrom.filter(
      (candidate) => UUID_PATTERN.test(candidate) && candidate !== toAccountId,
    );

    const moved = await this.membership.transferMembership({
      environment,
      fromAccountIds,
      toAccountId,
    });
    this.logger.log(
      `RevenueCat webhook TRANSFER to account ${toAccountId}: events=${moved.eventsMoved} periods=${moved.periodsMoved}`,
    );
    return {
      handled: true,
      detail: moved.eventsMoved > 0 ? 'transfer_applied' : 'transfer_noop',
      duplicate: moved.eventsMoved === 0,
    };
  }

  private async activeAccountIds(appUserIds: readonly string[]): Promise<string[]> {
    const candidates = appUserIds.filter((appUserId) => UUID_PATTERN.test(appUserId));
    if (candidates.length === 0) return [];
    const accounts = await this.accounts.find({ where: { id: In(candidates) } });
    return accounts
      .filter((account) => account.status === RegisteredAccountStatus.Active)
      .map((account) => account.id);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RevenueCat lists both sides of a transfer as app user id arrays that mix
 * Registered Account identifiers with its own anonymous identifiers.
 */
function appUserIdList(event: Record<string, unknown>, field: string): string[] {
  const value = event[field];
  if (!Array.isArray(value)) {
    throw new BadRequestException(`Event is missing or has invalid field: ${field}`);
  }
  return value.filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
  );
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
