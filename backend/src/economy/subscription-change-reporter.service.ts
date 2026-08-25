import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

import { PrincipalType } from '../auth/entities';
import { EventsService } from '../events';
import { toCommerceOwnerPrincipal } from './commerce-owner';
import type { MembershipPlanChangeActivation } from './membership.repository';

export type SubscriptionChangePlatform = 'ios' | 'android';

/**
 * Records `subscription_change_completed` for a Scheduled Plan Change from the
 * server that observed the activation (issue #126). The client cannot: the
 * activation lands at the next renewal, long after the session that requested
 * the change, so a device-local memory of the scheduled state counts the event
 * twice for a player with two devices and not at all for one who reinstalls or
 * never opens the Commerce Store while the change is pending.
 */
@Injectable()
export class SubscriptionChangeReporter {
  private readonly logger = new Logger(SubscriptionChangeReporter.name);

  constructor(private readonly events: EventsService) {}

  async reportPlanChangeActivated(
    activation: MembershipPlanChangeActivation,
    platform: SubscriptionChangePlatform,
  ): Promise<boolean> {
    const principal = toCommerceOwnerPrincipal(activation.owner);
    try {
      const result = await this.events.ingest(
        {
          id: principal.principalId,
          type: principal.principalType === 'account'
            ? PrincipalType.Account
            : PrincipalType.Guest,
        },
        [{
          // The event id and the occurrence timestamp are both derived from the
          // activation itself, so a webhook replay — or a later event on the
          // same subscription re-observing the same activation — lands on the
          // ingest primary key and inserts nothing.
          eventId: deterministicEventId(
            `subscription_change_completed:${activation.activationKey}`,
          ),
          occurredAt: activation.activatedAt.toISOString(),
          kind: 'subscription_change_completed',
          payload: {
            source_plan: `premium_${activation.sourcePlan}`,
            target_plan: `premium_${activation.targetPlan}`,
            platform,
          },
        }],
      );
      return result.insertedCount > 0;
    } catch (error) {
      // Analytics must never fail a webhook that already moved the entitlement:
      // an activation older than the retained window is rejected on ingest, and
      // losing that one row is preferable to replaying the whole event.
      this.logger.warn(
        `subscription_change_completed not recorded for activation ${activation.activationKey}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return false;
    }
  }
}

/**
 * A name-based UUID over the activation key: the ingest primary key is
 * `(event_id, occurred_at)`, so idempotency needs an identifier that every
 * observation of one activation agrees on rather than a fresh random one.
 */
function deterministicEventId(name: string): string {
  const bytes = createHash('sha256').update(name).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20),
  ].join('-');
}
