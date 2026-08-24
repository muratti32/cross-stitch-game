import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { RegisteredAccountStatus, type RegisteredAccountEntity } from '../auth/entities';
import type { CommerceLedgerRepository } from './commerce-ledger.repository';
import type { MembershipRepository } from './membership.repository';
import { RevenueCatWebhookService } from './revenuecat-webhook.service';

const OLD_ACCOUNT_ID = '8f1f3d6c-2c6e-4b3f-9a1e-1d0c9b8a7654';
const NEW_ACCOUNT_ID = 'd278d6bc-2ba1-42aa-a940-8a6d2a4b3d8b';
const GUEST_ID = 'b7c2f5ea-52d9-4f1e-9a30-1f6a5c0f2d11';
const ANON_ID = '$RCAnonymousID:b23fc87a5bb346b9a6c74ce20704f991';
const OLD_ANON_ID = '$RCAnonymousID:7068e7ea825f4092a62a4b49ac7bc4e9';

interface GuestAttemptsStub {
  applyWebhook?: jest.Mock;
  resolveMappedOwner?: jest.Mock;
  resolveMappedGuest?: jest.Mock;
  bindSubscribers?: jest.Mock;
}

function buildService(overrides: {
  accounts?: readonly { id: string; status: RegisteredAccountStatus }[];
  transferMembership?: jest.Mock;
  guestAttempts?: GuestAttemptsStub;
  processPurchase?: jest.Mock;
  account?: { id: string; status: RegisteredAccountStatus } | null;
}) {
  const accountRows = overrides.accounts ?? [
    { id: NEW_ACCOUNT_ID, status: RegisteredAccountStatus.Active },
  ];
  const transferMembership =
    overrides.transferMembership ??
    jest.fn().mockResolvedValue({ eventsMoved: 3, periodsMoved: 1 });
  const membership = { transferMembership } as unknown as MembershipRepository;
  const processPurchase = overrides.processPurchase ?? jest.fn();
  const commerceLedger = { processPurchase } as unknown as CommerceLedgerRepository;
  const accounts = {
    find: jest.fn().mockResolvedValue(accountRows),
    findOne: jest.fn().mockResolvedValue(overrides.account ?? null),
  } as unknown as Repository<RegisteredAccountEntity>;

  const guestAttempts = overrides.guestAttempts === undefined
    ? undefined
    : {
      applyWebhook: overrides.guestAttempts.applyWebhook ?? jest.fn().mockResolvedValue(null),
      resolveMappedOwner: overrides.guestAttempts.resolveMappedOwner ?? jest.fn().mockResolvedValue(null),
      resolveMappedGuest: overrides.guestAttempts.resolveMappedGuest ?? jest.fn().mockResolvedValue(null),
      bindSubscribers: overrides.guestAttempts.bindSubscribers ?? jest.fn().mockResolvedValue(undefined),
    };

  return {
    service: new RevenueCatWebhookService(commerceLedger, membership, accounts, guestAttempts as never),
    accounts,
    guestAttempts,
    transferMembership,
    processPurchase,
  };
}

function transferEvent(event: Record<string, unknown> = {}): unknown {
  return {
    event: {
      id: 'event-transfer-1',
      type: 'TRANSFER',
      environment: 'SANDBOX',
      store: 'APP_STORE',
      transferred_from: [OLD_ACCOUNT_ID, '$RCAnonymousID:4e15ebe0e0784311a9e02fb0a45fa23d'],
      transferred_to: [NEW_ACCOUNT_ID],
      event_timestamp_ms: 1786174524006,
      ...event,
    },
  };
}

describe('RevenueCatWebhookService TRANSFER', () => {
  it('re-anchors membership on the account the subscription moved to', async () => {
    const { service, transferMembership } = buildService({});

    await expect(service.handleEvent(transferEvent())).resolves.toEqual({
      handled: true,
      detail: 'transfer_applied',
      duplicate: false,
    });
    // Anonymous RevenueCat identifiers are not Registered Accounts and never
    // own membership rows, so only the account identifier is moved.
    expect(transferMembership).toHaveBeenCalledWith({
      environment: 'sandbox',
      fromAccountIds: [OLD_ACCOUNT_ID],
      toOwner: { type: 'account', accountId: NEW_ACCOUNT_ID },
    });
  });

  it('reports a redelivered transfer as a duplicate once nothing is left to move', async () => {
    const { service } = buildService({
      transferMembership: jest.fn().mockResolvedValue({ eventsMoved: 0, periodsMoved: 0 }),
    });

    await expect(service.handleEvent(transferEvent())).resolves.toEqual({
      handled: true,
      detail: 'transfer_noop',
      duplicate: true,
    });
  });

  it('does not move membership when neither side resolves to an owner', async () => {
    const { service, transferMembership } = buildService({ accounts: [] });

    await expect(service.handleEvent(transferEvent())).resolves.toEqual({
      handled: false,
      detail: 'transfer_target_unresolved',
      duplicate: false,
    });
    expect(transferMembership).not.toHaveBeenCalled();
  });

  it('moves membership onto the Guest the destination subscriber is mapped to', async () => {
    const resolveMappedOwner = jest.fn().mockResolvedValue({
      status: 'resolved', owner: { type: 'guest', guestInstallationId: GUEST_ID }, ids: [ANON_ID],
    });
    const { service, transferMembership, guestAttempts } = buildService({
      accounts: [],
      guestAttempts: { resolveMappedOwner },
    });

    await expect(
      service.handleEvent(transferEvent({ transferred_to: [ANON_ID] })),
    ).resolves.toEqual({ handled: true, detail: 'transfer_applied', duplicate: false });
    expect(transferMembership).toHaveBeenCalledWith({
      environment: 'sandbox',
      fromAccountIds: [OLD_ACCOUNT_ID],
      toOwner: { type: 'guest', guestInstallationId: GUEST_ID },
    });
    expect(guestAttempts?.bindSubscribers).not.toHaveBeenCalled();
  });

  it('inherits the source owner and claims the rotated subscriber when the destination is unmapped', async () => {
    // RevenueCat rotates the anonymous identifier on sign-out: without this the
    // following RENEWAL is rejected as an unknown principal.
    const resolveMappedOwner = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        status: 'resolved', owner: { type: 'guest', guestInstallationId: GUEST_ID }, ids: [OLD_ANON_ID],
      });
    const { service, transferMembership, guestAttempts } = buildService({
      accounts: [],
      guestAttempts: { resolveMappedOwner },
    });

    await expect(
      service.handleEvent(transferEvent({
        transferred_from: [OLD_ANON_ID],
        transferred_to: [ANON_ID],
      })),
    ).resolves.toEqual({ handled: true, detail: 'transfer_applied', duplicate: false });
    expect(guestAttempts?.bindSubscribers).toHaveBeenCalledWith(
      { type: 'guest', guestInstallationId: GUEST_ID },
      [ANON_ID],
    );
    expect(transferMembership).toHaveBeenCalledWith({
      environment: 'sandbox',
      fromAccountIds: [],
      toOwner: { type: 'guest', guestInstallationId: GUEST_ID },
    });
  });

  it('inherits an active source account when the destination is an unmapped subscriber', async () => {
    const { service, transferMembership, guestAttempts } = buildService({
      accounts: [{ id: OLD_ACCOUNT_ID, status: RegisteredAccountStatus.Active }],
      guestAttempts: {},
    });

    await expect(
      service.handleEvent(transferEvent({ transferred_to: [ANON_ID] })),
    ).resolves.toEqual({ handled: true, detail: 'transfer_applied', duplicate: false });
    expect(guestAttempts?.bindSubscribers).toHaveBeenCalledWith(
      { type: 'account', accountId: OLD_ACCOUNT_ID },
      [ANON_ID],
    );
    expect(transferMembership).toHaveBeenCalledWith({
      environment: 'sandbox',
      fromAccountIds: [],
      toOwner: { type: 'account', accountId: OLD_ACCOUNT_ID },
    });
  });

  it('refuses to guess an owner when the source carries both an account and a Guest mapping', async () => {
    const resolveMappedOwner = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        status: 'resolved', owner: { type: 'guest', guestInstallationId: GUEST_ID }, ids: [OLD_ANON_ID],
      });
    const { service, transferMembership } = buildService({
      accounts: [{ id: OLD_ACCOUNT_ID, status: RegisteredAccountStatus.Active }],
      guestAttempts: { resolveMappedOwner },
    });

    await expect(
      service.handleEvent(transferEvent({ transferred_to: [ANON_ID] })),
    ).resolves.toEqual({
      handled: false, detail: 'guest_subscriber_alias_conflict', duplicate: false,
    });
    expect(transferMembership).not.toHaveBeenCalled();
  });

  it('rejects a transfer payload without subscriber lists', async () => {
    const { service } = buildService({});

    await expect(
      service.handleEvent(transferEvent({ transferred_to: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still requires purchase fields on the event types that carry them', async () => {
    const { service } = buildService({});

    await expect(
      service.handleEvent({
        event: { id: 'event-1', type: 'INITIAL_PURCHASE', environment: 'SANDBOX' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RevenueCatWebhookService guest/account routing', () => {
  it('routes an account app user to account commerce before historical guest aliases', async () => {
    const processPurchase = jest.fn().mockResolvedValue({
      outcome: 'granted', currency: 'coin', amount: 300, balance: 300,
    });
    const applyWebhook = jest.fn().mockResolvedValue({
      handled: false, detail: 'guest_purchase_attempt_not_found', duplicate: false,
    });
    const { service } = buildService({
      processPurchase,
      guestAttempts: { applyWebhook },
      account: { id: NEW_ACCOUNT_ID, status: RegisteredAccountStatus.Active },
    });

    await expect(service.handleEvent({ event: {
      type: 'NON_RENEWING_PURCHASE', environment: 'SANDBOX',
      app_user_id: NEW_ACCOUNT_ID, aliases: ['$RCAnonymousID:old-guest'],
      transaction_id: 'account-tx', product_id: 'com.avk.stitchwish.coin_pack_300',
    } })).resolves.toMatchObject({ handled: true, detail: 'granted' });
    expect(applyWebhook).not.toHaveBeenCalled();
    expect(processPurchase).toHaveBeenCalledWith(expect.objectContaining({ accountId: NEW_ACCOUNT_ID }));
  });
});
