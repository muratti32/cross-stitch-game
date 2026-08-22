import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { configureApi } from '../src/api/configure-api';
import { EmailOutboxDispatcherService } from '../src/auth/email-outbox-dispatcher.service';
import { EMAIL_SENDER } from '../src/auth/email-sender.interface';
import { LocalEmailSender } from '../src/auth/local-email-sender';
import { OBJECT_STORAGE } from '../src/catalog/storage/object-storage.interface';
import { LocalObjectStorage } from '../src/catalog/storage/local-object-storage';
import { AccountDeletionFinalizerService } from '../src/deletion/account-deletion-finalizer.service';

/**
 * Guest Data Reset and Account Deletion Finalization both erase the rows that
 * make a grant unique for the erased identity. What survives them — the
 * transaction binding, the ledger entry, the grant tombstone — is what stops a
 * restored store subscription from paying its purchased value out a second
 * time. Only a real PostgreSQL can prove those constraints hold, so this suite
 * drives the whole path through the HTTP API.
 */
describe('Guest Data Reset and Account Deletion regrant protection', () => {
  const WEBHOOK_TOKEN = 'integration-test-only-revenuecat-webhook-auth-token-at-least-32-chars';
  const IOS = 'StitchWish/iOS';

  let app: INestApplication;
  let httpServer: Server;
  let dataSource: DataSource;
  let emailDispatcher: EmailOutboxDispatcherService;
  let localEmailSender: LocalEmailSender;
  let deletionFinalizer: AccountDeletionFinalizerService;

  beforeAll(async () => {
    const { ApiAppModule } = await import('../src/app.api.module');
    // The overrides pin the offline email sender and object storage so the
    // suite never reaches a real provider, whatever the environment carries.
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useFactory({
        factory: (local: LocalEmailSender) => local,
        inject: [LocalEmailSender],
      })
      .overrideProvider(OBJECT_STORAGE)
      .useFactory({
        factory: (local: LocalObjectStorage) => local,
        inject: [LocalObjectStorage],
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApi(app);
    await app.init();

    httpServer = app.getHttpServer() as Server;
    dataSource = app.get(DataSource);
    emailDispatcher = app.get(EmailOutboxDispatcherService);
    localEmailSender = app.get(LocalEmailSender);
    deletionFinalizer = app.get(AccountDeletionFinalizerService);
  });

  afterAll(async () => {
    if (app !== undefined) {
      await app.close();
    }
  });

  function readString(body: unknown, key: string): string {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value !== 'string') {
      throw new TypeError(`Expected ${key} to be a string`);
    }
    return value;
  }

  interface GuestSession {
    accessToken: string;
    guestId: string;
  }

  async function newGuest(): Promise<GuestSession> {
    const response = await request(httpServer)
      .post('/v1/auth/guest')
      .send({
        credentialSecret: randomBytes(32).toString('base64url'),
        installationKey: randomUUID(),
      })
      .expect(201);
    return {
      accessToken: readString(response.body, 'accessToken'),
      guestId: readString(response.body, 'guestId'),
    };
  }

  async function newRegisteredAccount(): Promise<{ accountId: string; accessToken: string }> {
    const email = `regrant-${randomUUID()}@example.test`;
    await request(httpServer).post('/v1/auth/email/request').send({ email }).expect(202);

    let code: string | undefined;
    for (let round = 0; round < 20 && code === undefined; round++) {
      const dispatched = await emailDispatcher.dispatchOnce();
      code = localEmailSender
        .getDeliveries()
        .slice()
        .reverse()
        .find((candidate) => candidate.toEmail === email)?.code;
      if (code === undefined && dispatched === 0) break;
    }
    if (code === undefined) throw new Error(`No email OTP was delivered for ${email}`);

    const verified = await request(httpServer)
      .post('/v1/auth/email/verify')
      .send({ code, email })
      .expect(200);
    return {
      accessToken: readString(verified.body, 'accessToken'),
      accountId: readString(verified.body, 'accountId'),
    };
  }

  function guestHeaders(accessToken: string) {
    return { Authorization: `Bearer ${accessToken}`, 'User-Agent': IOS };
  }

  function webhook(event: Record<string, unknown>) {
    return request(httpServer)
      .post('/v1/commerce/revenuecat/webhook')
      .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
      .send({ event });
  }

  function premiumEvent(input: {
    subscriberId: string;
    transactionId: string;
    originalTransactionId: string;
  }): Record<string, unknown> {
    const now = Date.now();
    return {
      id: `regrant-premium-${randomUUID()}`,
      type: 'INITIAL_PURCHASE',
      app_user_id: input.subscriberId,
      aliases: [input.subscriberId],
      transaction_id: input.transactionId,
      original_transaction_id: input.originalTransactionId,
      product_id: 'com.avk.stitchwish.premium_monthly',
      period_type: 'NORMAL',
      environment: 'SANDBOX',
      event_timestamp_ms: now,
      purchased_at_ms: now,
      expiration_at_ms: now + 30 * 86_400_000,
    };
  }

  it('restores Premium after a Guest Data Reset without paying its value twice', async () => {
    const first = await newGuest();
    const subscriberId = `$RCAnonymousID:${randomUUID()}`;
    const transactionId = `reset-premium-tx-${randomUUID()}`;
    const originalTransactionId = `reset-premium-original-${randomUUID()}`;

    await request(httpServer)
      .post('/v1/commerce/guest/revenuecat-mapping')
      .set(guestHeaders(first.accessToken))
      .send({ subscriberId })
      .expect(201);
    await request(httpServer)
      .post('/v1/commerce/guest/purchase-attempts')
      .set(guestHeaders(first.accessToken))
      .send({
        productId: 'com.avk.stitchwish.premium_monthly',
        idempotencyKey: `reset-premium-${randomUUID()}`,
        subscriberId,
      })
      .expect(201);
    await webhook(premiumEvent({ originalTransactionId, subscriberId, transactionId }))
      .expect(200, { status: 'ok' });

    // The paid identity receives the Membership Credit and one daily reward.
    await request(httpServer)
      .get('/v1/economy/ai-credit-balance')
      .set(guestHeaders(first.accessToken))
      .expect(200, { balance: 15 });
    await request(httpServer)
      .post('/v1/commerce/membership/daily-claim')
      .set(guestHeaders(first.accessToken))
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({ amount: 30, replayed: false });
      });

    await request(httpServer)
      .post('/v1/auth/guest/reset')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(204);

    // A fresh installation restores the same store subscription.
    const second = await newGuest();
    await request(httpServer)
      .post('/v1/commerce/guest/revenuecat-mapping')
      .set(guestHeaders(second.accessToken))
      .send({ subscriberId })
      .expect(201);
    await webhook(premiumEvent({ originalTransactionId, subscriberId, transactionId }))
      .expect(200, { status: 'ok' });

    // Premium itself comes back, because the store subscription is still paid for.
    await request(httpServer)
      .get('/v1/commerce/membership')
      .set(guestHeaders(second.accessToken))
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ active: true, plan: 'monthly' });
      });
    // The consumable value the erased identity already received does not.
    await request(httpServer)
      .get('/v1/economy/ai-credit-balance')
      .set(guestHeaders(second.accessToken))
      .expect(200, { balance: 0 });
    await request(httpServer)
      .post('/v1/commerce/membership/daily-claim')
      .set(guestHeaders(second.accessToken))
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({ amount: 0, replayed: true });
      });
    await request(httpServer)
      .get('/v1/economy/balance')
      .set(guestHeaders(second.accessToken))
      .expect(200, { balance: 0 });

    const tombstones = await dataSource.query<readonly { source_key: string }[]>(
      `SELECT source_key FROM economy.commerce_grant_tombstones
       WHERE source_key = $1 OR source_key LIKE $2
       ORDER BY source_key`,
      [`membership:sandbox:${transactionId}`, `premium_daily:sandbox:${transactionId}:%`],
    );
    expect(tombstones).toHaveLength(2);
  });

  it('refuses to redeliver a Coin Pack to the installation that replaces a reset Guest', async () => {
    const first = await newGuest();
    const subscriberId = `$RCAnonymousID:${randomUUID()}`;
    const transactionId = `reset-coin-tx-${randomUUID()}`;
    const coinWebhook = () =>
      webhook({
        type: 'NON_RENEWING_PURCHASE',
        app_user_id: subscriberId,
        aliases: [subscriberId],
        transaction_id: transactionId,
        product_id: 'com.avk.stitchwish.coin_pack_300',
        environment: 'SANDBOX',
      });

    await request(httpServer)
      .post('/v1/commerce/guest/revenuecat-mapping')
      .set(guestHeaders(first.accessToken))
      .send({ subscriberId })
      .expect(201);
    await request(httpServer)
      .post('/v1/commerce/guest/purchase-attempts')
      .set(guestHeaders(first.accessToken))
      .send({
        productId: 'com.avk.stitchwish.coin_pack_300',
        idempotencyKey: `reset-coin-${randomUUID()}`,
        subscriberId,
      })
      .expect(201);
    await coinWebhook().expect(200, { status: 'ok' });
    await request(httpServer)
      .get('/v1/economy/balance')
      .set(guestHeaders(first.accessToken))
      .expect(200, { balance: 300 });

    await request(httpServer)
      .post('/v1/auth/guest/reset')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(204);

    const second = await newGuest();
    await request(httpServer)
      .post('/v1/commerce/guest/revenuecat-mapping')
      .set(guestHeaders(second.accessToken))
      .send({ subscriberId })
      .expect(201);
    await coinWebhook().expect(200, { status: 'ok' });

    // The Commerce Transaction Binding outlives the reset, so the Stitch Coin
    // of that one store transaction stays spent.
    await request(httpServer)
      .get('/v1/economy/balance')
      .set(guestHeaders(second.accessToken))
      .expect(200, { balance: 0 });
    const bindings = await dataSource.query<readonly { principal_id: string }[]>(
      `SELECT principal_id FROM economy.commerce_transaction_bindings
       WHERE environment = 'sandbox' AND provider_transaction_id = $1`,
      [transactionId],
    );
    expect(bindings).toEqual([{ principal_id: first.guestId }]);
  });

  it('restores a finalized account subscription to a Guest without regranting its credit', async () => {
    const account = await newRegisteredAccount();
    const transactionId = `deleted-premium-tx-${randomUUID()}`;
    const originalTransactionId = `deleted-premium-original-${randomUUID()}`;

    await webhook(
      premiumEvent({
        originalTransactionId,
        subscriberId: account.accountId,
        transactionId,
      }),
    ).expect(200, { status: 'ok' });
    await request(httpServer)
      .get('/v1/economy/ai-credit-balance')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200, { balance: 15 });

    await request(httpServer)
      .post('/v1/account/deletion')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ confirmation: 'DELETE' })
      .expect(200);
    // Age the Recovery Window instead of waiting it out.
    await dataSource.query(
      `UPDATE deletion.account_deletion_requests
       SET recovery_window_ends_at = now() - interval '1 day'
       WHERE account_id = $1 AND status = 'pending'`,
      [account.accountId],
    );
    expect(await deletionFinalizer.finalizeDueRequests()).toBeGreaterThanOrEqual(1);

    // Account Deletion Finalization keeps the AI Credit ledger entry so the
    // restore below finds the grant already spent, even though the balance the
    // account held was forfeited.
    const [ledger, balances] = await Promise.all([
      dataSource.query<readonly { source_key: string }[]>(
        `SELECT source_key FROM economy.ai_credit_ledger_entries WHERE source_key = $1`,
        [`membership:sandbox:${transactionId}`],
      ),
      dataSource.query<readonly { balance: string }[]>(
        `SELECT balance FROM economy.ai_credit_balances
         WHERE principal_type = 'account' AND principal_id = $1`,
        [account.accountId],
      ),
    ]);
    expect(ledger).toHaveLength(1);
    expect(balances).toHaveLength(0);

    const guest = await newGuest();
    const subscriberId = `$RCAnonymousID:${randomUUID()}`;
    await request(httpServer)
      .post('/v1/commerce/guest/revenuecat-mapping')
      .set(guestHeaders(guest.accessToken))
      .send({ subscriberId })
      .expect(201);
    await webhook(premiumEvent({ originalTransactionId, subscriberId, transactionId }))
      .expect(200, { status: 'ok' });

    await request(httpServer)
      .get('/v1/commerce/membership')
      .set(guestHeaders(guest.accessToken))
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ active: true, plan: 'monthly' });
      });
    await request(httpServer)
      .get('/v1/economy/ai-credit-balance')
      .set(guestHeaders(guest.accessToken))
      .expect(200, { balance: 0 });
  });
});
