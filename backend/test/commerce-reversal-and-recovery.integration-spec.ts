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
import { CatalogService } from '../src/catalog/catalog.service';
import { encodePatternArtifactV1 } from '../src/catalog/pattern-artifact-encoder';
import { LocalObjectStorage } from '../src/catalog/storage/local-object-storage';
import { OBJECT_STORAGE } from '../src/catalog/storage/object-storage.interface';
import { AppConfigService } from '../src/config/app-config.service';

describe('Commerce reversal and operational recovery', () => {
  const WEBHOOK_TOKEN = 'integration-test-only-revenuecat-webhook-auth-token-at-least-32-chars';
  const IOS = 'StitchWish/iOS';
  const coinProduct = 'com.avk.stitchwish.coin_pack_300';
  const aiProduct = 'com.avk.stitchwish.ai_credit_pack_5';

  let app: INestApplication;
  let httpServer: Server;
  let dataSource: DataSource;
  let emailDispatcher: EmailOutboxDispatcherService;
  let localEmailSender: LocalEmailSender;

  beforeAll(async () => {
    const { ApiAppModule } = await import('../src/app.api.module');
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useFactory({ factory: (local: LocalEmailSender) => local, inject: [LocalEmailSender] })
      .overrideProvider(OBJECT_STORAGE)
      .useFactory({ factory: (local: LocalObjectStorage) => local, inject: [LocalObjectStorage] })
      .compile();

    app = moduleRef.createNestApplication();
    configureApi(app);
    await app.init();
    httpServer = app.getHttpServer() as Server;
    dataSource = app.get(DataSource);
    emailDispatcher = app.get(EmailOutboxDispatcherService);
    localEmailSender = app.get(LocalEmailSender);
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
  });

  function readString(body: unknown, key: string): string {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value !== 'string') throw new TypeError(`Expected ${key} to be a string`);
    return value;
  }

  function readField(body: unknown, key: string): unknown {
    return (body as Record<string, unknown>)[key];
  }

  function readNumber(body: unknown, key: string): number {
    const value = readField(body, key);
    if (typeof value !== 'number') throw new TypeError(`Expected ${key} to be a number`);
    return value;
  }

  interface GuestSession { accessToken: string; guestId: string }
  interface AccountSession { accessToken: string; accountId: string }

  async function newGuest(): Promise<GuestSession> {
    const response = await request(httpServer).post('/v1/auth/guest').send({
      credentialSecret: randomBytes(32).toString('base64url'), installationKey: randomUUID(),
    }).expect(201);
    return { accessToken: readString(response.body, 'accessToken'), guestId: readString(response.body, 'guestId') };
  }

  async function newRegisteredAccount(): Promise<AccountSession> {
    const email = `reversal-${randomUUID()}@example.test`;
    await request(httpServer).post('/v1/auth/email/request').send({ email }).expect(202);
    let code: string | undefined;
    for (let round = 0; round < 20 && code === undefined; round++) {
      const dispatched = await emailDispatcher.dispatchOnce();
      code = localEmailSender.getDeliveries().slice().reverse().find((candidate) => candidate.toEmail === email)?.code;
      if (code === undefined && dispatched === 0) break;
    }
    if (code === undefined) throw new Error(`No email OTP was delivered for ${email}`);
    const verified = await request(httpServer).post('/v1/auth/email/verify').send({ code, email }).expect(200);
    return { accessToken: readString(verified.body, 'accessToken'), accountId: readString(verified.body, 'accountId') };
  }

  function guestHeaders(accessToken: string) {
    return { Authorization: `Bearer ${accessToken}`, 'User-Agent': IOS };
  }

  function authHeaders(accessToken: string) { return { Authorization: `Bearer ${accessToken}` }; }

  function webhook(event: Record<string, unknown>) {
    return request(httpServer).post('/v1/commerce/revenuecat/webhook')
      .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`).send({ event });
  }

  function premiumEvent(input: {
    subscriberId: string;
    transactionId: string;
    originalTransactionId: string;
    type?: string;
    periodType?: string;
    cancelReason?: string;
    eventTimestampMs?: number;
    expirationAtMs?: number | null;
    productId?: string;
    id?: string;
  }): Record<string, unknown> {
    const now = input.eventTimestampMs ?? Date.now();
    return {
      id: input.id ?? `evt-${randomUUID()}`,
      type: input.type ?? 'INITIAL_PURCHASE',
      app_user_id: input.subscriberId,
      aliases: [input.subscriberId],
      transaction_id: input.transactionId,
      original_transaction_id: input.originalTransactionId,
      product_id: input.productId ?? 'com.avk.stitchwish.premium_monthly',
      period_type: input.periodType ?? 'NORMAL',
      environment: 'SANDBOX',
      event_timestamp_ms: now,
      purchased_at_ms: now,
      expiration_at_ms: input.expirationAtMs === undefined ? now + 30 * 86_400_000 : input.expirationAtMs,
      ...(input.cancelReason === undefined ? {} : { cancel_reason: input.cancelReason }),
    };
  }

  async function mapGuest(guest: GuestSession, subscriberId: string): Promise<void> {
    await request(httpServer).post('/v1/commerce/guest/revenuecat-mapping')
      .set(guestHeaders(guest.accessToken)).send({ subscriberId }).expect(201);
  }

  async function guestCoinPurchase(guest: GuestSession, subscriberId = `$RCAnonymousID:${randomUUID()}`) {
    await mapGuest(guest, subscriberId);
    const transactionId = `coin-${randomUUID()}`;
    const attempt = await request(httpServer).post('/v1/commerce/guest/purchase-attempts')
      .set(guestHeaders(guest.accessToken)).send({ productId: coinProduct, idempotencyKey: randomUUID(), subscriberId }).expect(201);
    await webhook({ id: `evt-${randomUUID()}`, type: 'NON_RENEWING_PURCHASE', app_user_id: subscriberId,
      aliases: [subscriberId], transaction_id: transactionId, product_id: coinProduct, environment: 'SANDBOX' }).expect(200);
    return { transactionId, attemptId: readString(attempt.body, 'id'), subscriberId };
  }

  async function seedPaidPattern(title: string): Promise<string> {
    const palette = [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: 'B5200', name: 'Snow White', rgbHex: '#FFFFFF' },
    ];
    const encoded = encodePatternArtifactV1({ width: 5, height: 5, palette, grid: new Uint8Array(25).fill(1) });
    const objectKey = `itest-reversal/${title}/artifact.bin`;
    await app.get(LocalObjectStorage).put(objectKey, encoded.bytes);
    const pattern = await app.get(CatalogService).upsertPattern({
      title, creatorName: 'ITest Reversal Team', categoryCode: 'other', width: 5, height: 5,
      paletteSize: palette.length, artifactObjectKey: objectKey, artifactChecksum: encoded.checksum,
      artifactByteLength: encoded.byteLength, artifactSchemaVersion: encoded.schemaVersion,
      previewObjectKey: `itest-reversal/${title}/preview.png`, unlockPriceTier: 'small', status: 'available',
      publishedAt: new Date('2026-07-01T00:00:00.000Z'), tagCodes: [],
    });
    return pattern.id;
  }

  async function countRows(table: 'coin_ledger_entries' | 'ai_credit_ledger_entries', where: string, values: unknown[]): Promise<number> {
    const rows = await dataSource.query<readonly { count: string }[]>(`SELECT COUNT(*) AS count FROM economy.${table} WHERE ${where}`, values);
    return Number(rows[0].count);
  }

  describe('Commerce Reversal for Coin and AI Credit', () => {
    it('reverses a Guest Coin Pack once and ignores an identical refund replay', async () => {
      const guest = await newGuest();
      const purchase = await guestCoinPurchase(guest);
      await request(httpServer).get('/v1/economy/balance').set(guestHeaders(guest.accessToken)).expect(200, { balance: 300 });
      const refund = { id: `refund-${randomUUID()}`, type: 'REFUND', app_user_id: purchase.subscriberId, aliases: [purchase.subscriberId],
        transaction_id: purchase.transactionId, product_id: coinProduct, environment: 'SANDBOX' };
      await webhook(refund).expect(200, { status: 'ok' });
      await request(httpServer).get('/v1/economy/balance').set(guestHeaders(guest.accessToken)).expect(200, { balance: 0 });
      const count = () => countRows('coin_ledger_entries', "principal_type = 'guest' AND principal_id = $1 AND reason = 'commerce_reversal'", [guest.guestId]);
      expect(await count()).toBe(1);
      await webhook(refund).expect(200, { status: 'ok' });
      await request(httpServer).get('/v1/economy/balance').set(guestHeaders(guest.accessToken)).expect(200, { balance: 0 });
      expect(await count()).toBe(1);
    });

    it('keeps an unlock after reversing spent Coin and blocks new spending at a negative balance', async () => {
      const guest = await newGuest();
      await guestCoinPurchase(guest);
      const ownedPattern = await seedPaidPattern(`owned-${randomUUID()}`);
      const otherPattern = await seedPaidPattern(`other-${randomUUID()}`);
      await request(httpServer).post('/v1/economy/unlocks').set(guestHeaders(guest.accessToken)).send({ patternId: ownedPattern }).expect(201);
      const binding = await dataSource.query<readonly { provider_transaction_id: string }[]>(
        `SELECT provider_transaction_id FROM economy.commerce_transaction_bindings WHERE principal_type = 'guest' AND principal_id = $1`, [guest.guestId]);
      const refund = { id: `refund-${randomUUID()}`, type: 'REFUND', app_user_id: `$RCAnonymousID:unused-${randomUUID()}`,
        transaction_id: binding[0].provider_transaction_id, product_id: coinProduct, environment: 'SANDBOX' };
      await webhook(refund).expect(200, { status: 'ok' });
      await request(httpServer).get('/v1/economy/balance').set(guestHeaders(guest.accessToken)).expect(200, { balance: -75 });
      await request(httpServer).get('/v1/economy/unlocks').set(guestHeaders(guest.accessToken)).expect(200)
        .expect((response) => expect(readField(response.body, 'patternIds')).toContain(ownedPattern));
      await request(httpServer).post('/v1/economy/unlocks').set(guestHeaders(guest.accessToken)).send({ patternId: otherPattern }).expect(409)
        .expect((response) => expect(response.body).toMatchObject({ code: 'insufficient_balance', price: 75, balance: -75 }));
    });

    it('reverses an Account AI Credit Pack and writes one commerce reversal', async () => {
      const account = await newRegisteredAccount();
      const transactionId = `ai-${randomUUID()}`;
      const event = { id: `evt-${randomUUID()}`, type: 'NON_RENEWING_PURCHASE', app_user_id: account.accountId,
        aliases: [account.accountId], transaction_id: transactionId, product_id: aiProduct, environment: 'SANDBOX' };
      await webhook(event).expect(200, { status: 'ok' });
      await request(httpServer).get('/v1/economy/ai-credit-balance').set(authHeaders(account.accessToken)).expect(200, { balance: 5 });
      await webhook({ ...event, id: `refund-${randomUUID()}`, type: 'REFUND' }).expect(200, { status: 'ok' });
      await request(httpServer).get('/v1/economy/ai-credit-balance').set(authHeaders(account.accessToken)).expect(200, { balance: 0 });
      expect(await countRows('ai_credit_ledger_entries', "principal_type = 'account' AND principal_id = $1 AND reason = 'commerce_reversal'", [account.accountId])).toBe(1);
    });
  });

  describe('Membership Reversal recomputes entitlement', () => {
    it('refunds one monthly period, reverses its credit once, and deactivates the period', async () => {
      const guest = await newGuest(); const subscriberId = `$RCAnonymousID:${randomUUID()}`; await mapGuest(guest, subscriberId);
      const transactionId = `membership-${randomUUID()}`; const original = `original-${randomUUID()}`; const initial = premiumEvent({ subscriberId, transactionId, originalTransactionId: original });
      await webhook(initial).expect(200, { status: 'ok' });
      await request(httpServer).get('/v1/commerce/membership').set(guestHeaders(guest.accessToken)).expect(200)
        .expect((response) => expect(response.body).toMatchObject({ active: true, plan: 'monthly' }));
      const refund = premiumEvent({ subscriberId, transactionId, originalTransactionId: original, type: 'REFUND', eventTimestampMs: Date.now() + 1000 });
      await webhook(refund).expect(200, { status: 'ok' });
      await request(httpServer).get('/v1/commerce/membership').set(guestHeaders(guest.accessToken)).expect(200)
        .expect((response) => expect(response.body).toMatchObject({ active: false, plan: 'monthly', lifecycle: 'refunded' }));
      await request(httpServer).get('/v1/economy/ai-credit-balance').set(guestHeaders(guest.accessToken)).expect(200, { balance: 0 });
      const count = () => countRows('ai_credit_ledger_entries', "principal_type = 'guest' AND principal_id = $1 AND reason = 'membership_reversal'", [guest.guestId]);
      expect(await count()).toBe(1); await webhook(refund).expect(200, { status: 'ok' }); expect(await count()).toBe(1);
      await request(httpServer).get('/v1/economy/ai-credit-balance').set(guestHeaders(guest.accessToken)).expect(200, { balance: 0 });
    });

    it('keeps a separately valid annual period active after refunding an older monthly period', async () => {
      const guest = await newGuest(); const subscriberId = `$RCAnonymousID:${randomUUID()}`; await mapGuest(guest, subscriberId); const now = Date.now();
      await webhook(premiumEvent({ subscriberId, transactionId: `monthly-${randomUUID()}`, originalTransactionId: `monthly-original-${randomUUID()}`, eventTimestampMs: now - 2000 })).expect(200);
      const annualTx = `annual-${randomUUID()}`; const annualOriginal = `annual-original-${randomUUID()}`;
      await webhook(premiumEvent({ subscriberId, transactionId: annualTx, originalTransactionId: annualOriginal, productId: 'com.avk.stitchwish.premium_annual', expirationAtMs: now + 365 * 86_400_000, eventTimestampMs: now - 1000 })).expect(200);
      const monthly = await dataSource.query<readonly { provider_transaction_id: string; original_transaction_id: string }[]>(`SELECT provider_transaction_id, original_transaction_id FROM economy.membership_periods WHERE guest_installation_id = $1 AND plan = 'monthly'`, [guest.guestId]);
      await webhook(premiumEvent({ subscriberId, transactionId: monthly[0].provider_transaction_id, originalTransactionId: monthly[0].original_transaction_id, type: 'REFUND', eventTimestampMs: now })).expect(200);
      await request(httpServer).get('/v1/commerce/membership').set(guestHeaders(guest.accessToken)).expect(200)
        .expect((response) => expect(response.body).toMatchObject({ active: true, plan: 'annual' }));
    });
  });

  describe('Webhook idempotency: duplicate, delayed, replayed, out-of-order events', () => {
    it('grants a concurrently duplicated Guest Coin webhook once', async () => {
      const guest = await newGuest(); const subscriberId = `$RCAnonymousID:${randomUUID()}`;
      await mapGuest(guest, subscriberId);
      await request(httpServer).post('/v1/commerce/guest/purchase-attempts').set(guestHeaders(guest.accessToken)).send({ productId: coinProduct, idempotencyKey: randomUUID(), subscriberId }).expect(201);
      const event = {
        id: `evt-${randomUUID()}`, type: 'NON_RENEWING_PURCHASE', app_user_id: subscriberId, aliases: [subscriberId],
        transaction_id: `duplicate-${randomUUID()}`, product_id: coinProduct, environment: 'SANDBOX',
      };
      const responses = await Promise.all([webhook(event), webhook(event)]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      await request(httpServer).get('/v1/economy/balance').set(guestHeaders(guest.accessToken)).expect(200, { balance: 300 });
      const rows = await dataSource.query<readonly { count: string }[]>(`SELECT COUNT(*) AS count FROM economy.commerce_transaction_bindings WHERE environment = 'sandbox' AND provider_transaction_id = $1`, [event.transaction_id]);
      expect(Number(rows[0].count)).toBe(1);
    });

    it('accepts an earlier RENEWAL after a later INITIAL_PURCHASE without corrupting membership', async () => {
      const guest = await newGuest(); const subscriberId = `$RCAnonymousID:${randomUUID()}`; await mapGuest(guest, subscriberId); const now = Date.now();
      const input = { subscriberId, transactionId: `order-${randomUUID()}`, originalTransactionId: `order-original-${randomUUID()}` };
      await webhook(premiumEvent({ ...input, eventTimestampMs: now })).expect(200);
      await webhook(premiumEvent({ ...input, type: 'RENEWAL', eventTimestampMs: now - 10_000 })).expect(200);
      await request(httpServer).get('/v1/commerce/membership').set(guestHeaders(guest.accessToken)).expect(200)
        .expect((response) => expect(response.body).toMatchObject({ active: true, plan: 'monthly', lifecycle: 'active' }));
    });

    it('resolves a later RevenueCat alias to the mapped Guest and grants once', async () => {
      const guest = await newGuest(); const firstAlias = `$RCAnonymousID:${randomUUID()}`; const secondAlias = `$RCAnonymousID:${randomUUID()}`; await mapGuest(guest, firstAlias);
      const attempt = await request(httpServer).post('/v1/commerce/guest/purchase-attempts').set(guestHeaders(guest.accessToken)).send({ productId: coinProduct, idempotencyKey: randomUUID(), subscriberId: firstAlias }).expect(201);
      const event = { id: `evt-${randomUUID()}`, type: 'NON_RENEWING_PURCHASE', app_user_id: secondAlias, aliases: [firstAlias, secondAlias], original_app_user_id: firstAlias,
        transaction_id: `alias-${randomUUID()}`, product_id: coinProduct, environment: 'SANDBOX' };
      await webhook(event).expect(200); await webhook(event).expect(200);
      await request(httpServer).get(`/v1/commerce/guest/purchase-attempts/${readString(attempt.body, 'id')}`).set(guestHeaders(guest.accessToken)).expect(200)
        .expect((response) => expect(readString(response.body, 'status')).toBe('granted'));
      await request(httpServer).get('/v1/economy/balance').set(guestHeaders(guest.accessToken)).expect(200, { balance: 300 });
    });
  });

  describe('TRANSFER idempotency', () => {
    it('moves an Account membership once and makes the replay a no-op', async () => {
      const from = await newRegisteredAccount(); const to = await newRegisteredAccount(); const now = Date.now();
      const transactionId = `transfer-${randomUUID()}`; const original = `transfer-original-${randomUUID()}`;
      await webhook(premiumEvent({ subscriberId: from.accountId, transactionId, originalTransactionId: original, productId: 'com.avk.stitchwish.premium_annual', expirationAtMs: now + 365 * 86_400_000 })).expect(200);
      const transfer = { id: `transfer-event-${randomUUID()}`, type: 'TRANSFER', environment: 'SANDBOX', transferred_from: [from.accountId], transferred_to: [to.accountId] };
      await webhook(transfer).expect(200); await webhook(transfer).expect(200);
      await request(httpServer).get('/v1/commerce/membership').set(authHeaders(to.accessToken)).expect(200)
        .expect((response) => expect(response.body).toMatchObject({ active: true, plan: 'annual' }));
      await request(httpServer).get('/v1/commerce/membership').set(authHeaders(from.accessToken)).expect(200)
        .expect((response) => expect(readField(response.body, 'active')).toBe(false));
      const rows = await dataSource.query<readonly { account_id: string; count: string }[]>(`SELECT account_id, COUNT(*) AS count FROM economy.membership_periods WHERE environment = 'sandbox' AND provider_transaction_id = $1 GROUP BY account_id`, [transactionId]);
      expect(rows).toEqual([{ account_id: to.accountId, count: '1' }]);
    });
  });

  describe('Concurrent webhook delivery cannot double-bind or double-grant', () => {
    it('binds a raced Coin transaction to only one Account', async () => {
      const first = await newRegisteredAccount(); const second = await newRegisteredAccount(); const transactionId = `race-${randomUUID()}`;
      const event = (accountId: string) => ({ id: `evt-${randomUUID()}`, type: 'NON_RENEWING_PURCHASE', app_user_id: accountId, aliases: [accountId], transaction_id: transactionId, product_id: coinProduct, environment: 'SANDBOX' });
      const responses = await Promise.all([webhook(event(first.accountId)), webhook(event(second.accountId))]); expect(responses.map((response) => response.status).sort()).toEqual([200, 503]);
      const balances = await Promise.all([request(httpServer).get('/v1/economy/balance').set(authHeaders(first.accessToken)), request(httpServer).get('/v1/economy/balance').set(authHeaders(second.accessToken))]);
      expect(balances.map((response) => readNumber(response.body, 'balance')).sort()).toEqual([0, 300]);
      const rows = await dataSource.query<readonly { principal_id: string; account_id: string; count: string }[]>(`SELECT principal_id, account_id, COUNT(*) AS count FROM economy.commerce_transaction_bindings WHERE environment = 'sandbox' AND provider_transaction_id = $1 GROUP BY principal_id, account_id`, [transactionId]);
      expect(rows).toHaveLength(1); expect(rows[0].principal_id).toBe(rows[0].account_id); expect([first.accountId, second.accountId]).toContain(rows[0].account_id); expect(rows[0].count).toBe('1');
    });
  });

  describe('Capability disablement blocks new Guest Purchase Attempts but not existing operations', () => {
    it('blocks new Guest mapping/attempts, still processes refund and TRANSFER, then restores normal behavior', async () => {
      const guest = await newGuest(); const purchase = await guestCoinPurchase(guest); const subscriberId = purchase.subscriberId; const account = await newRegisteredAccount();
      const memberTx = `disabled-transfer-${randomUUID()}`; const memberOriginal = `disabled-original-${randomUUID()}`;
      const membershipSubscriber = `$RCAnonymousID:membership-${randomUUID()}`;
      await mapGuest(guest, membershipSubscriber);
      await webhook(premiumEvent({ subscriberId: membershipSubscriber, transactionId: memberTx, originalTransactionId: memberOriginal })).expect(200);
      const config = app.get(AppConfigService); const toggle = jest.spyOn(config, 'iosGuestCommerceEnabled', 'get').mockReturnValue(false);
      try {
        await request(httpServer).get('/v1/commerce/capabilities').set(guestHeaders(guest.accessToken)).expect(200, { guestCommerceAvailable: false });
        await request(httpServer).post('/v1/commerce/guest/revenuecat-mapping').set(guestHeaders(guest.accessToken)).send({ subscriberId: `$RCAnonymousID:new-${randomUUID()}` }).expect(403);
        await request(httpServer).post('/v1/commerce/guest/purchase-attempts').set(guestHeaders(guest.accessToken)).send({ productId: coinProduct, idempotencyKey: randomUUID(), subscriberId }).expect(403);
        await webhook({ id: `refund-${randomUUID()}`, type: 'REFUND', app_user_id: subscriberId, transaction_id: purchase.transactionId, product_id: coinProduct, environment: 'SANDBOX' }).expect(200);
        await request(httpServer).get('/v1/economy/balance').set(guestHeaders(guest.accessToken)).expect(200, { balance: 0 });
        await webhook({ id: `transfer-${randomUUID()}`, type: 'TRANSFER', environment: 'SANDBOX', transferred_from: [membershipSubscriber], transferred_to: [account.accountId] }).expect(200);
      } finally { toggle.mockRestore(); }
      await request(httpServer).get('/v1/commerce/capabilities').set(guestHeaders(guest.accessToken)).expect(200, { guestCommerceAvailable: true });
      await request(httpServer).post('/v1/commerce/guest/revenuecat-mapping').set(guestHeaders(guest.accessToken)).send({ subscriberId: `$RCAnonymousID:restored-${randomUUID()}` }).expect(201);
    });
  });
});
