import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { configureApi } from '../src/api/configure-api';
import { EmailOutboxDispatcherService } from '../src/auth/email-outbox-dispatcher.service';
import { EMAIL_SENDER } from '../src/auth/email-sender.interface';
import { LocalEmailSender } from '../src/auth/local-email-sender';
import { LocalObjectStorage } from '../src/catalog/storage/local-object-storage';
import { OBJECT_STORAGE } from '../src/catalog/storage/object-storage.interface';

describe('Commerce migration backfill compatibility', () => {
  const WEBHOOK_TOKEN =
    'integration-test-only-revenuecat-webhook-auth-token-at-least-32-chars';
  const coinProduct = 'com.avk.stitchwish.coin_pack_300';

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

  interface AccountSession {
    accessToken: string;
    accountId: string;
  }

  async function newRegisteredAccount(): Promise<AccountSession> {
    const email = `migration-backfill-${randomUUID()}@example.test`;
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

  function authHeaders(accessToken: string) {
    return { Authorization: `Bearer ${accessToken}` };
  }

  function webhook(event: Record<string, unknown>) {
    return request(httpServer)
      .post('/v1/commerce/revenuecat/webhook')
      .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
      .send({ event });
  }

  async function rerunMigrationBackfills(): Promise<void> {
    await dataSource.query(`
      UPDATE economy.commerce_transaction_bindings
      SET account_id = principal_id
      WHERE principal_type = 'account' AND account_id IS NULL
    `);
    await dataSource.query(`
      DO $$
      DECLARE r record; l record; b bigint; p bigint; free bigint;
      BEGIN
        FOR r IN SELECT DISTINCT principal_type, principal_id FROM economy.coin_ledger_entries LOOP
          b := 0; p := 0;
          FOR l IN SELECT amount, reason FROM economy.coin_ledger_entries WHERE principal_type=r.principal_type AND principal_id=r.principal_id ORDER BY created_at, id LOOP
            IF l.reason = 'coin_pack_purchase' AND l.amount > 0 THEN p := p + l.amount;
            ELSIF l.reason = 'commerce_reversal' AND l.amount < 0 THEN p := GREATEST(0, p - LEAST(p, -l.amount));
            ELSIF l.amount < 0 THEN free := GREATEST(0, b - p); p := GREATEST(0, p - GREATEST(0, -l.amount - free)); END IF;
            b := b + l.amount;
          END LOOP;
          UPDATE economy.coin_balances SET paid_balance=p WHERE principal_type=r.principal_type AND principal_id=r.principal_id;
        END LOOP;
        FOR r IN SELECT DISTINCT principal_type, principal_id FROM economy.ai_credit_ledger_entries LOOP
          b := 0; p := 0;
          FOR l IN SELECT amount, reason FROM economy.ai_credit_ledger_entries WHERE principal_type=r.principal_type AND principal_id=r.principal_id ORDER BY created_at, id LOOP
            IF l.reason = 'pack_purchase' AND l.amount > 0 THEN p := p + l.amount;
            ELSIF l.reason = 'commerce_reversal' AND l.amount < 0 THEN p := GREATEST(0, p - LEAST(p, -l.amount));
            ELSIF l.amount < 0 THEN free := GREATEST(0, b - p); p := GREATEST(0, p - GREATEST(0, -l.amount - free)); END IF;
            b := b + l.amount;
          END LOOP;
          UPDATE economy.ai_credit_balances SET paid_balance=p WHERE principal_type=r.principal_type AND principal_id=r.principal_id;
        END LOOP;
      END $$;
    `);
    await dataSource.query(`
      UPDATE economy.ai_credit_ledger_entries
      SET source_key = replace(source_key, 'membership:guest:', 'membership:')
      WHERE source_key LIKE 'membership:guest:%'
    `);
    await dataSource.query(`
      UPDATE economy.ai_credit_ledger_entries
      SET source_key = replace(source_key, 'membership_reversal:guest:', 'membership_reversal:')
      WHERE source_key LIKE 'membership_reversal:guest:%'
    `);
  }

  it('preserves pre-existing Registered Account purchase, refund and membership data', async () => {
    const account = await newRegisteredAccount();
    const transactionId = `legacy-coin-${randomUUID()}`;
    const membershipTransactionId = `legacy-membership-${randomUUID()}`;
    const now = new Date();
    const membershipEnd = new Date(now.getTime() + 30 * 86_400_000);

    await dataSource.transaction(async (manager) => {
      await manager.query(`
        ALTER TABLE economy.commerce_transaction_bindings
        DROP CONSTRAINT "CHK_commerce_transaction_bindings_owner"
      `);
      await manager.query(
        `INSERT INTO economy.commerce_transaction_bindings
           (environment, provider_transaction_id, principal_type, principal_id,
            product_id, currency, granted_amount, account_id, guest_installation_id)
         VALUES ('sandbox', $1, 'account', $2, $3, 'coin', 300, NULL, NULL)`,
        [transactionId, account.accountId, coinProduct],
      );
      await manager.query(`
        UPDATE economy.commerce_transaction_bindings
        SET account_id = principal_id
        WHERE principal_type = 'account' AND account_id IS NULL
      `);
      await manager.query(`
        ALTER TABLE economy.commerce_transaction_bindings
        ADD CONSTRAINT "CHK_commerce_transaction_bindings_owner"
        CHECK (
          (principal_type = 'account' AND account_id = principal_id AND guest_installation_id IS NULL)
          OR
          (principal_type = 'guest' AND guest_installation_id = principal_id AND account_id IS NULL)
        )
      `);
      await manager.query(
        `INSERT INTO economy.coin_ledger_entries
           (principal_type, principal_id, amount, reason, source_key, granted, metadata)
         VALUES ('account', $1, 300, 'coin_pack_purchase', $2, true, NULL)`,
        [account.accountId, `commerce:sandbox:${transactionId}`],
      );
      await manager.query(
        `INSERT INTO economy.coin_balances
           (principal_type, principal_id, balance, paid_balance)
         VALUES ('account', $1, 300, 300)`,
        [account.accountId],
      );
      await manager.query(
        `INSERT INTO economy.membership_periods
           (environment, provider_transaction_id, original_transaction_id,
            account_id, guest_installation_id, product_id, plan, period_type,
            starts_at, ends_at, current_status, status_event_at, credit_amount)
         VALUES ('sandbox', $1, $2, $3, NULL,
                 'com.avk.stitchwish.premium_monthly', 'monthly', 'NORMAL',
                 $4, $5, 'active', $4, 15)`,
        [membershipTransactionId, `original-${membershipTransactionId}`, account.accountId, now, membershipEnd],
      );
    });

    const before = await dataSource.query<readonly {
      account_id: string;
      guest_installation_id: string | null;
      principal_id: string;
    }[]>(
      `SELECT account_id, guest_installation_id, principal_id
       FROM economy.commerce_transaction_bindings
       WHERE environment = 'sandbox' AND provider_transaction_id = $1`,
      [transactionId],
    );
    expect(before).toEqual([{
      account_id: account.accountId,
      guest_installation_id: null,
      principal_id: account.accountId,
    }]);

    await rerunMigrationBackfills();
    const stateAfterFirstRerun = await dataSource.query<readonly {
      account_id: string;
      balance: string;
      guest_installation_id: string | null;
      paid_balance: string;
      principal_id: string;
    }[]>(
      `SELECT binding.account_id, binding.guest_installation_id, binding.principal_id,
              balance.balance, balance.paid_balance
       FROM economy.commerce_transaction_bindings binding
       JOIN economy.coin_balances balance
         ON balance.principal_type = binding.principal_type
        AND balance.principal_id = binding.principal_id
       WHERE binding.environment = 'sandbox'
         AND binding.provider_transaction_id = $1`,
      [transactionId],
    );
    await rerunMigrationBackfills();

    const after = await dataSource.query<readonly {
      account_id: string;
      guest_installation_id: string | null;
      principal_id: string;
    }[]>(
      `SELECT account_id, guest_installation_id, principal_id
       FROM economy.commerce_transaction_bindings
       WHERE environment = 'sandbox' AND provider_transaction_id = $1`,
      [transactionId],
    );
    expect(after).toEqual(before);
    const stateAfterSecondRerun = await dataSource.query<readonly {
      account_id: string;
      balance: string;
      guest_installation_id: string | null;
      paid_balance: string;
      principal_id: string;
    }[]>(
      `SELECT binding.account_id, binding.guest_installation_id, binding.principal_id,
              balance.balance, balance.paid_balance
       FROM economy.commerce_transaction_bindings binding
       JOIN economy.coin_balances balance
         ON balance.principal_type = binding.principal_type
        AND balance.principal_id = binding.principal_id
       WHERE binding.environment = 'sandbox'
         AND binding.provider_transaction_id = $1`,
      [transactionId],
    );
    expect(stateAfterSecondRerun).toEqual(stateAfterFirstRerun);
    expect(stateAfterSecondRerun[0]?.paid_balance).toBe('300');

    const membershipOwners = await dataSource.query<readonly {
      account_id: string;
      guest_installation_id: string | null;
    }[]>(
      `SELECT account_id, guest_installation_id
       FROM economy.membership_periods
       WHERE environment = 'sandbox' AND provider_transaction_id = $1`,
      [membershipTransactionId],
    );
    expect(membershipOwners).toEqual([{
      account_id: account.accountId,
      guest_installation_id: null,
    }]);

    await request(httpServer)
      .get('/v1/economy/balance')
      .set(authHeaders(account.accessToken))
      .expect(200, { balance: 300 });
    await request(httpServer)
      .get('/v1/commerce/membership')
      .set(authHeaders(account.accessToken))
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ active: true, plan: 'monthly' });
        expect(readField(response.body, 'lifecycle')).toBe('active');
      });

    await webhook({
      id: `refund-${randomUUID()}`,
      type: 'REFUND',
      app_user_id: account.accountId,
      aliases: [account.accountId],
      transaction_id: transactionId,
      product_id: coinProduct,
      environment: 'SANDBOX',
    }).expect(200, { status: 'ok' });
    await request(httpServer)
      .get('/v1/economy/balance')
      .set(authHeaders(account.accessToken))
      .expect(200, { balance: 0 });

    const finalBinding = await dataSource.query<readonly {
      account_id: string;
      guest_installation_id: string | null;
      reversed_at: Date | null;
    }[]>(
      `SELECT account_id, guest_installation_id, reversed_at
       FROM economy.commerce_transaction_bindings
       WHERE environment = 'sandbox' AND provider_transaction_id = $1`,
      [transactionId],
    );
    expect(finalBinding[0]?.account_id).toBe(account.accountId);
    expect(finalBinding[0]?.guest_installation_id).toBeNull();
    expect(finalBinding[0]?.reversed_at).toBeInstanceOf(Date);
  });
});
