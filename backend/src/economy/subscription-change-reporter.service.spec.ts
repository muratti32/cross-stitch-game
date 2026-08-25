import { BadRequestException } from '@nestjs/common';

import type { EventsService } from '../events';
import type { MembershipPlanChangeActivation } from './membership.repository';
import { SubscriptionChangeReporter } from './subscription-change-reporter.service';

const ACCOUNT_ID = 'd278d6bc-2ba1-42aa-a940-8a6d2a4b3d8b';

function activation(
  overrides: Partial<MembershipPlanChangeActivation> = {},
): MembershipPlanChangeActivation {
  return {
    owner: { type: 'account', accountId: ACCOUNT_ID },
    sourcePlan: 'annual',
    targetPlan: 'weekly',
    activatedAt: new Date('2026-09-15T00:00:00.000Z'),
    activationKey: 'production:event-product-change-1',
    ...overrides,
  };
}

function buildReporter(ingest?: jest.Mock) {
  const call = ingest ?? jest.fn().mockResolvedValue({
    accepted: true, receivedCount: 1, insertedCount: 1,
  });
  return {
    reporter: new SubscriptionChangeReporter({ ingest: call } as unknown as EventsService),
    ingest: call,
  };
}

describe('SubscriptionChangeReporter', () => {
  it('records the activation as subscription_change_completed for the owning principal', async () => {
    const { reporter, ingest } = buildReporter();

    await expect(reporter.reportPlanChangeActivated(activation(), 'ios')).resolves.toBe(true);
    expect(ingest).toHaveBeenCalledWith(
      { id: ACCOUNT_ID, type: 'account' },
      [expect.objectContaining({
        occurredAt: '2026-09-15T00:00:00.000Z',
        kind: 'subscription_change_completed',
        payload: {
          source_plan: 'premium_annual',
          target_plan: 'premium_weekly',
          platform: 'ios',
        },
      })],
    );
  });

  it('records a Guest activation against the Guest Installation', async () => {
    const { reporter, ingest } = buildReporter();

    await reporter.reportPlanChangeActivated(
      activation({ owner: { type: 'guest', guestInstallationId: ACCOUNT_ID } }),
      'android',
    );
    expect(ingest).toHaveBeenCalledWith(
      { id: ACCOUNT_ID, type: 'guest' },
      expect.anything(),
    );
  });

  it('derives one event id per plan-change request, so a replay inserts nothing', async () => {
    const { reporter, ingest } = buildReporter();

    await reporter.reportPlanChangeActivated(activation(), 'ios');
    await reporter.reportPlanChangeActivated(activation(), 'ios');
    const [[, first], [, second]] = ingest.mock.calls as [
      [unknown, readonly { eventId: string }[]],
      [unknown, readonly { eventId: string }[]],
    ];
    expect(first[0]!.eventId).toBe(second[0]!.eventId);
    expect(first[0]!.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('gives a different event id to a different plan-change request', async () => {
    const { reporter, ingest } = buildReporter();

    await reporter.reportPlanChangeActivated(activation(), 'ios');
    await reporter.reportPlanChangeActivated(
      activation({ activationKey: 'production:event-product-change-2' }),
      'ios',
    );
    const [[, first], [, second]] = ingest.mock.calls as [
      [unknown, readonly { eventId: string }[]],
      [unknown, readonly { eventId: string }[]],
    ];
    expect(first[0]!.eventId).not.toBe(second[0]!.eventId);
  });

  it('reports a replayed activation as not recorded rather than as a new one', async () => {
    const { reporter } = buildReporter(jest.fn().mockResolvedValue({
      accepted: true, receivedCount: 1, insertedCount: 0,
    }));

    await expect(reporter.reportPlanChangeActivated(activation(), 'ios')).resolves.toBe(false);
  });

  it('never fails the webhook when the event stream refuses the activation', async () => {
    const { reporter } = buildReporter(jest.fn().mockRejectedValue(
      new BadRequestException('Gameplay event occurredAt is older than the retention window'),
    ));

    await expect(reporter.reportPlanChangeActivated(activation(), 'ios')).resolves.toBe(false);
  });
});
