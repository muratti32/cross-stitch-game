import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { RegisteredAccountEntity, RegisteredAccountStatus } from '../auth/entities';
import { CommerceLedgerRepository } from './commerce-ledger.repository';
import { MembershipRepository } from './membership.repository';
import { resolvePremiumProduct, type PremiumProduct } from './membership.constants';
import type { VerifiedMembershipEvent } from './membership-projection';
import { GuestPurchaseAttemptService, type MappedGuest } from './guest-purchase-attempt.service';
import type { CommerceOwner } from './commerce-owner';

export interface RevenueCatWebhookOutcome {
  handled: boolean; // false for event types this ticket doesn't own
  detail: string; // short machine-readable reason for logging
  duplicate: boolean;
}

@Injectable()
export class RevenueCatWebhookService {
  private readonly logger = new Logger(RevenueCatWebhookService.name);

  private redactTransaction(transactionId: string): string {
    return `txn_${createHash('sha256').update(transactionId).digest('hex').slice(0, 12)}`;
  }

  private redactPrincipal(id: string): string {
    return `acct_${createHash('sha256').update(id).digest('hex').slice(0, 10)}`;
  }

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
    const aliases = Array.isArray(evt.aliases)
      ? evt.aliases.filter((value): value is string => typeof value === 'string')
      : [];
    const originalAppUserId = typeof evt.original_app_user_id === 'string'
      ? [evt.original_app_user_id]
      : [];

    if (type === 'NON_RENEWING_PURCHASE') {
      if (account && account.status === RegisteredAccountStatus.Active) {
        return this.applyAccountPurchase(account.id, productId, environment, transactionId);
      }
      const guestResult = this.guestAttempts === undefined ? null : await this.guestAttempts.applyWebhook(
        [appUserId, ...aliases, ...originalAppUserId],
        productId,
        environment,
        transactionId,
      );
      if (guestResult !== null) return guestResult;
      // A subscriber the app user id no longer names can still be mapped to a
      // Registered Account after a promotion or a transfer.
      const mappedOwner = this.guestAttempts === undefined
        ? null
        : await this.guestAttempts.resolveMappedOwner([appUserId, ...aliases, ...originalAppUserId]);
      if (mappedOwner?.status === 'resolved' && mappedOwner.owner.type === 'account') {
        const mappedAccount = await this.accounts.findOne({ where: { id: mappedOwner.owner.accountId } });
        if (mappedAccount && mappedAccount.status === RegisteredAccountStatus.Active) {
          return this.applyAccountPurchase(mappedAccount.id, productId, environment, transactionId);
        }
      }
    }

    const premiumProduct = resolvePremiumProduct(productId);
    if (premiumProduct && MEMBERSHIP_EVENT_TYPES.has(type) && (!account || account.status !== RegisteredAccountStatus.Active)) {
      const mappedOwner = this.guestAttempts === undefined
        ? null
        : await this.guestAttempts.resolveMappedOwner([appUserId, ...aliases, ...originalAppUserId]);
      if (mappedOwner?.status === 'alias_conflict') {
        return { handled: false, detail: 'guest_subscriber_alias_conflict', duplicate: false };
      }
      // A mapping that names a Registered Account belongs to a promoted Guest,
      // so the Membership is recorded on that account rather than on a Guest
      // Installation that no longer owns the entitlement.
      if (mappedOwner !== null && mappedOwner.owner.type === 'account') {
        const owner = mappedOwner.owner;
        const mappedAccount = await this.accounts.findOne({ where: { id: owner.accountId } });
        if (mappedAccount && mappedAccount.status === RegisteredAccountStatus.Active) {
          return this.applyAccountMembership(
            evt, environment, owner.accountId, premiumProduct, type, transactionId,
            [appUserId, ...aliases, ...originalAppUserId],
          );
        }
      }
      const mapped: MappedGuest | null = mappedOwner !== null && mappedOwner.owner.type === 'guest'
        ? { status: 'resolved', guestId: mappedOwner.owner.guestInstallationId, ids: mappedOwner.ids }
        : null;
      if (mapped !== null) {
        const membershipEvent = parseMembershipEvent(evt, environment, {
          type: 'guest', guestInstallationId: mapped.guestId,
        });
        if (membershipEvent.periodType === 'TRIAL' && premiumProduct.plan !== 'monthly') {
          throw new BadRequestException('Only the Monthly Premium Plan may have a trial');
        }
        const result = await this.membership.recordVerifiedEvent(membershipEvent);
        if (result.rejectedOtherAccount) {
          this.logger.warn(
            `RevenueCat membership fraud signal: transaction ${this.redactTransaction(transactionId)} is bound to another account`,
          );
        }
        await this.guestAttempts?.markMembershipWebhook(
          mapped,
          [productId, ...(typeof evt.new_product_id === 'string' ? [evt.new_product_id] : [])],
          transactionId,
          type,
          result,
        );
        if (result.rejectedOtherAccount) {
          return { handled: true, detail: 'rejected_other_account', duplicate: false };
        }
        return {
          handled: true,
          detail: result.recorded ? 'membership_event_recorded' : 'membership_event_replayed',
          duplicate: !result.recorded,
        };
      }
    }

    // A Commerce Reversal is keyed by the provider transaction alone, so it must
    // run before the Registered Account guard below: a refunded Guest purchase has
    // no account to resolve, and RevenueCat may deliver the refund under a
    // different subscriber alias than the one that made the purchase.
    if (
      !premiumProduct &&
      (type === 'REFUND' ||
        (type === 'CANCELLATION' && evt.cancel_reason === 'CUSTOMER_SUPPORT'))
    ) {
      const result = await this.commerceLedger.processReversal({
        environment,
        providerTransactionId: transactionId,
      });

      this.logger.log(
        `RevenueCat webhook REFUND transaction ${this.redactTransaction(transactionId)}: applied=${result.applied} currency=${result.currency} amount=${result.amount} balance=${result.balance}`,
      );

      return {
        handled: true,
        detail: result.applied ? 'reversed' : 'no_binding_to_reverse',
        duplicate: !result.applied,
      };
    }

    if (!account || account.status !== RegisteredAccountStatus.Active) {
      this.logger.warn(
        `RevenueCat webhook ${type} rejected: account ${this.redactPrincipal(appUserId)} does not exist or is inactive`,
      );
      return { handled: false, detail: 'unknown_or_inactive_account', duplicate: false };
    }

    if (premiumProduct && MEMBERSHIP_EVENT_TYPES.has(type)) {
      return this.applyAccountMembership(
        evt, environment, appUserId, premiumProduct, type, transactionId,
        [appUserId, ...aliases, ...originalAppUserId],
      );
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
          `RevenueCat webhook NON_RENEWING_PURCHASE fraud signal: transaction ${this.redactTransaction(transactionId)} already bound to a different account (claimed by ${this.redactPrincipal(appUserId)})`,
        );
      } else {
        this.logger.log(
          `RevenueCat webhook NON_RENEWING_PURCHASE transaction ${this.redactTransaction(transactionId)}: outcome=${result.outcome} currency=${result.currency} amount=${result.amount} balance=${result.balance}`,
        );
      }

      return {
        handled: true,
        detail: result.outcome,
        duplicate: result.outcome === 'replayed_same_account',
      };
    }

    this.logger.debug(`RevenueCat webhook ignored event type: ${type}`);
    return {
      handled: false,
      detail: 'ignored_event_type',
      duplicate: false,
    };
  }

  private async applyAccountMembership(
    evt: Record<string, unknown>,
    environment: 'sandbox' | 'production',
    accountId: string,
    premiumProduct: PremiumProduct,
    type: string,
    transactionId: string,
    subscriberIds: readonly string[] = [],
  ): Promise<RevenueCatWebhookOutcome> {
    const membershipEvent = parseMembershipEvent(evt, environment, {
      type: 'account', accountId,
    });
    if (membershipEvent.periodType === 'TRIAL' && premiumProduct.plan !== 'monthly') {
      throw new BadRequestException('Only the Monthly Premium Plan may have a trial');
    }
    let result = await this.membership.recordVerifiedEvent(membershipEvent);
    if (result.rejectedOtherAccount) {
      // Signing in to an existing Registered Account is not a transfer for
      // RevenueCat: it aliases the Guest's anonymous subscriber onto the
      // account and keeps delivering the same subscription under the account
      // id. The Membership still sits on the Guest Installation that bought
      // it, so the ownership guard sees a conflict for a purchase that never
      // changed hands (ADR-0048).
      const adopted = await this.adoptAliasOwnedMembership(
        environment, transactionId, accountId, subscriberIds,
      );
      if (adopted) {
        result = await this.membership.recordVerifiedEvent(membershipEvent);
      }
    }
    if (result.rejectedOtherAccount) {
      this.logger.warn(
        `RevenueCat membership fraud signal: transaction ${this.redactTransaction(transactionId)} is bound to another account`,
      );
      return { handled: true, detail: 'rejected_other_account', duplicate: false };
    }
    this.logger.log(
      `RevenueCat membership ${type} transaction ${this.redactTransaction(transactionId)}: recorded=${result.recorded} granted=${result.creditGranted} reversed=${result.creditReversed}`,
    );
    return {
      handled: true,
      detail: result.recorded ? 'membership_event_recorded' : 'membership_event_replayed',
      duplicate: !result.recorded,
    };
  }

  /**
   * Moves a Guest-owned Membership onto the Registered Account the same
   * RevenueCat customer now signs in as. The move is taken only when every
   * recorded owner of the transaction is one Guest Installation and the
   * event's own alias list still maps to that Guest: RevenueCat states those
   * identifiers belong to one customer, so the claim is the same player rather
   * than a second one reaching for a purchase they never made.
   */
  private async adoptAliasOwnedMembership(
    environment: 'sandbox' | 'production',
    transactionId: string,
    accountId: string,
    subscriberIds: readonly string[],
  ): Promise<boolean> {
    const guestAttempts = this.guestAttempts;
    if (guestAttempts === undefined || subscriberIds.length === 0) return false;
    const owners = await this.membership.getTransactionOwners(environment, transactionId);
    const guestIds = new Set<string>();
    for (const owner of owners) {
      if (owner.type !== 'guest') return false;
      guestIds.add(owner.guestInstallationId);
    }
    if (guestIds.size !== 1) return false;
    const [guestId] = [...guestIds];
    if (guestId === undefined) return false;

    const ids = [...new Set(subscriberIds)];
    const mapped = await Promise.all(
      ids.map((id) => guestAttempts.resolveSubscriberOwner(id)),
    );
    const claims = mapped.filter((owner): owner is CommerceOwner => owner !== null);
    if (claims.length === 0) return false;
    // A subscriber already claimed by a different principal makes the alias
    // list ambiguous, so the Membership stays where it is and support decides.
    const aliasesAgree = claims.every((owner) =>
      (owner.type === 'guest' && owner.guestInstallationId === guestId)
      || (owner.type === 'account' && owner.accountId === accountId));
    if (!aliasesAgree) return false;
    if (!claims.some((owner) => owner.type === 'guest')) return false;

    const moved = await this.membership.transferMembership({
      environment,
      fromAccountIds: [],
      fromGuestIds: [guestId],
      toOwner: { type: 'account', accountId },
    });
    await guestAttempts.bindSubscribers({ type: 'account', accountId }, ids);
    this.logger.log(
      `RevenueCat membership adopted by ${this.redactPrincipal(accountId)} from an aliased Guest: events=${moved.eventsMoved} periods=${moved.periodsMoved}`,
    );
    return moved.eventsMoved > 0;
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
    if (targets.length > 1) {
      this.logger.warn(
        `RevenueCat webhook TRANSFER rejected: transferred_to resolves to ${targets.length} active accounts`,
      );
      return { handled: false, detail: 'transfer_target_unresolved', duplicate: false };
    }

    const resolvedTarget = await this.resolveTransferTarget(transferredTo, transferredFrom, targets);
    if (resolvedTarget === null) {
      this.logger.warn(
        'RevenueCat webhook TRANSFER rejected: transferred_to resolves to 0 active accounts',
      );
      return { handled: false, detail: 'transfer_target_unresolved', duplicate: false };
    }
    if (resolvedTarget === 'alias_conflict') {
      return { handled: false, detail: 'guest_subscriber_alias_conflict', duplicate: false };
    }
    const toOwner = resolvedTarget;

    const toAccountId = toOwner.type === 'account' ? toOwner.accountId : null;
    const fromAccountIds = transferredFrom.filter(
      (candidate) => UUID_PATTERN.test(candidate) && candidate !== toAccountId,
    );
    const mappedGuest = this.guestAttempts === undefined
      ? null
      : await this.guestAttempts.resolveMappedGuest(transferredFrom);
    const toGuestId = toOwner.type === 'guest' ? toOwner.guestInstallationId : null;
    const fromGuestIds = mappedGuest?.status === 'resolved' && mappedGuest.guestId !== toGuestId
      ? [mappedGuest.guestId]
      : [];

    const moved = await this.membership.transferMembership({
      environment,
      fromAccountIds,
      ...(fromGuestIds.length > 0 ? { fromGuestIds } : {}),
      toOwner,
    });
    this.logger.log(
      `RevenueCat webhook TRANSFER to ${toOwner.type} ${this.redactPrincipal(toAccountId ?? toGuestId ?? '')}: events=${moved.eventsMoved} periods=${moved.periodsMoved}`,
    );
    return {
      handled: true,
      detail: moved.eventsMoved > 0 ? 'transfer_applied' : 'transfer_noop',
      duplicate: moved.eventsMoved === 0,
    };
  }

  /**
   * RevenueCat rotates the anonymous subscriber identifier on sign-out and
   * reports the rotation as a TRANSFER whose destination is that brand new
   * identifier: it is neither a Registered Account nor a mapped Guest yet.
   * Inheriting the source owner and claiming the destination identifiers for it
   * is what keeps the following RENEWAL events resolvable; without it every
   * later event for this subscription is rejected as an unknown principal.
   */
  private async resolveTransferTarget(
    transferredTo: readonly string[],
    transferredFrom: readonly string[],
    activeTargets: readonly string[],
  ): Promise<CommerceOwner | 'alias_conflict' | null> {
    const target = activeTargets[0];
    if (target !== undefined) return { type: 'account', accountId: target };
    if (this.guestAttempts === undefined) return null;

    const mappedTarget = await this.guestAttempts.resolveMappedOwner(transferredTo);
    if (mappedTarget?.status === 'alias_conflict') return 'alias_conflict';
    if (mappedTarget !== null) return mappedTarget.owner;

    // The destination is unmapped, so the owner can only come from the source
    // side of the move.
    const sourceAccounts = await this.activeAccountIds(transferredFrom);
    if (sourceAccounts.length > 1) return null;
    const mappedSource = await this.guestAttempts.resolveMappedOwner(transferredFrom);
    if (mappedSource?.status === 'alias_conflict') return 'alias_conflict';
    const sourceAccountId = sourceAccounts[0];
    const inherited: CommerceOwner | null = mappedSource !== null
      ? mappedSource.owner
      : sourceAccountId !== undefined
        ? { type: 'account', accountId: sourceAccountId }
        : null;
    if (inherited === null) return null;
    if (mappedSource !== null && sourceAccountId !== undefined && inherited.type === 'guest') {
      // The source carries both an active account and a Guest mapping; which of
      // them owns the subscription cannot be decided from this event alone.
      return 'alias_conflict';
    }
    await this.guestAttempts.bindSubscribers(inherited, transferredTo);
    return inherited;
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
  owner: import('./commerce-owner').CommerceOwner,
): VerifiedMembershipEvent {
  const providerEventId = requiredString(event, 'id');
  const providerTransactionId = requiredString(event, 'transaction_id');
  const originalTransactionId = requiredString(event, 'original_transaction_id');
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
  const newProductId =
    typeof event.new_product_id === 'string' ? event.new_product_id : null;

  return {
    environment,
    providerEventId,
    providerTransactionId,
    originalTransactionId,
    owner,
    type,
    productId,
    periodType,
    eventAt,
    purchasedAt,
    expiresAt,
    gracePeriodExpiresAt,
    cancelReason,
    newProductId,
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
