import 'reflect-metadata';

import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { LocatorPriceAdminService } from '../src/admin/locator-price-admin.service';
import { OperatorAuditLogService } from '../src/admin/operator-audit-log.service';
import type { AuthPrincipal } from '../src/auth/auth.types';
import { PrincipalType } from '../src/auth/entities';
import { createTypeOrmOptions } from '../src/database/typeorm-options';
import { EconomyReadService } from '../src/economy/economy-read.service';
import { LocatorAttemptService } from '../src/economy/locator-attempt.service';

/**
 * ADR-0060: the operator-managed Locator Price is locked on each reservation,
 * a stale expected price is rejected without charge, and every change is
 * audited. Only a real PostgreSQL proves the migration, CHECK constraints,
 * and the FOR SHARE / FOR UPDATE interplay.
 */
describe('Operator-managed Locator Price', () => {
  let dataSource: DataSource;
  let locator: LocatorAttemptService;
  let admin: LocatorPriceAdminService;
  let operatorId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) throw new Error('DATABASE_URL is not set by global setup');
    dataSource = new DataSource(createTypeOrmOptions(url));
    await dataSource.initialize();
    locator = new LocatorAttemptService(dataSource);
    admin = new LocatorPriceAdminService(dataSource, new OperatorAuditLogService());
    const operators = await dataSource.query<readonly { id: string }[]>(
      `INSERT INTO admin.operator_accounts (email, password_hash, totp_secret_encrypted)
       VALUES ($1, 'integration-only', 'integration-only') RETURNING id`,
      [`locator-price-${randomUUID()}@example.test`],
    );
    operatorId = operators[0].id;
  });

  afterEach(async () => {
    await dataSource.query('UPDATE economy.locator_price_setting SET price_coin = 1 WHERE id = 1');
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function guestWithSession(balance: number): Promise<{ principal: AuthPrincipal; sessionId: string; patternId: string }> {
    const principalId = randomUUID();
    const patternId = randomUUID();
    await dataSource.query(
      `INSERT INTO catalog.patterns
        (id, title, description, creator_name, category_code, width, height,
         palette_size, artifact_object_key, artifact_checksum, artifact_byte_length,
         artifact_schema_version, preview_object_key, visibility, status)
       VALUES ($1, 'Locator Price', 'Locator Price fixture.', 'Stitch Wish', 'other', 2, 2,
         2, 'official/locator-price.bin', $2, 100, 1, 'official/locator-price.png', 'catalog', 'available')`,
      [patternId, 'a'.repeat(64)],
    );
    await dataSource.query(
      `INSERT INTO economy.coin_balances (principal_type, principal_id, balance, paid_balance) VALUES ('guest', $1, $2, 0)`,
      [principalId, balance],
    );
    const sessions = await dataSource.query<readonly { id: string }[]>(
      `INSERT INTO sessions.stitching_sessions (principal_type, principal_id, pattern_id, status)
       VALUES ('guest', $1, $2, 'active') RETURNING id`,
      [principalId, patternId],
    );
    return {
      principal: { id: principalId, type: PrincipalType.Guest, tokenVersion: 1 },
      sessionId: sessions[0].id,
      patternId,
    };
  }

  async function balanceOf(principal: AuthPrincipal): Promise<number> {
    const rows = await dataSource.query<readonly { balance: string }[]>(
      `SELECT balance FROM economy.coin_balances WHERE principal_type = 'guest' AND principal_id = $1`,
      [principal.id],
    );
    return Number(rows[0]?.balance);
  }

  it('seeds the former fixed price and serves it with the balance', async () => {
    const { principal } = await guestWithSession(7);
    const read = new EconomyReadService(
      { getBalance: () => Promise.resolve(7) } as never,
      {} as never,
      dataSource,
    );
    await expect(read.getBalance(principal)).resolves.toEqual({ balance: 7, locatorPrice: 1 });
    await expect(admin.get()).resolves.toMatchObject({ price: 1, minPrice: 1, maxPrice: 10 });
  });

  it('enforces the 1–10 range and the singleton row in the database', async () => {
    await expect(dataSource.query('UPDATE economy.locator_price_setting SET price_coin = 0 WHERE id = 1')).rejects.toThrow();
    await expect(dataSource.query('UPDATE economy.locator_price_setting SET price_coin = 11 WHERE id = 1')).rejects.toThrow();
    await expect(dataSource.query('INSERT INTO economy.locator_price_setting (id, price_coin) VALUES (2, 1)')).rejects.toThrow();
  });

  it('audits a change and applies it to the next reservation only', async () => {
    const { principal, sessionId, patternId } = await guestWithSession(20);
    const base = { sessionId, patternId, colorIndex: 0, dmcCode: '310' };

    const lockedAttemptId = randomUUID();
    await expect(locator.prepare(principal, { ...base, attemptId: lockedAttemptId, expectedPrice: 1 }))
      .resolves.toMatchObject({ price: 1, balance: 19 });

    await expect(admin.update(operatorId, 4, 'req-locator-price')).resolves.toMatchObject({ price: 4, updatedByOperatorId: operatorId });
    const audit = await dataSource.query<readonly { before: unknown; after: unknown; action: string }[]>(
      `SELECT action, before, after FROM admin.operator_audit_log
       WHERE operator_account_id = $1 AND request_id = 'req-locator-price'`,
      [operatorId],
    );
    expect(audit).toEqual([{ action: 'economy.locator_price.update', before: { price: 1 }, after: { price: 4 } }]);

    // The open attempt keeps its locked price through commit.
    await expect(locator.commit(principal, lockedAttemptId, { targetCellIndex: 3 }))
      .resolves.toMatchObject({ status: 'committed', price: 1 });
    expect(await balanceOf(principal)).toBe(19);

    // A client still showing the old price is rejected without charge.
    const staleAttemptId = randomUUID();
    const stale = await locator.prepare(principal, { ...base, attemptId: staleAttemptId, expectedPrice: 1 })
      .catch((error: unknown) => error);
    expect(stale).toBeInstanceOf(ConflictException);
    expect((stale as ConflictException).getResponse()).toEqual({ code: 'locator_price_changed', price: 4, balance: 19 });
    expect(await balanceOf(principal)).toBe(19);
    const staleRows = await dataSource.query<readonly unknown[]>(
      'SELECT 1 FROM economy.locator_attempts WHERE attempt_id = $1',
      [staleAttemptId],
    );
    expect(staleRows).toHaveLength(0);

    // The next reservation at the new price holds and releases exactly 4.
    const freshAttemptId = randomUUID();
    await expect(locator.prepare(principal, { ...base, attemptId: freshAttemptId, expectedPrice: 4 }))
      .resolves.toMatchObject({ price: 4, balance: 15 });
    await admin.update(operatorId, 9, null);
    await expect(locator.release(principal, freshAttemptId, { cancellation: true }))
      .resolves.toMatchObject({ status: 'released', price: 4, balance: 19 });
  });

  it('never commits a leftover hold at a superseded price for a player shown the new price', async () => {
    await admin.update(operatorId, 5, null);
    const { principal, sessionId, patternId } = await guestWithSession(10);
    const base = { sessionId, patternId, colorIndex: 0, dmcCode: '310' };
    const leftover = randomUUID();
    await expect(locator.prepare(principal, { ...base, attemptId: leftover, expectedPrice: 5 }))
      .resolves.toMatchObject({ price: 5, balance: 5 });

    // The release was lost; the operator lowers the price and the player taps again.
    await admin.update(operatorId, 1, null);
    const retry = randomUUID();
    await expect(locator.prepare(principal, { ...base, attemptId: retry, expectedPrice: 1 }))
      .resolves.toMatchObject({ attemptId: retry, price: 1, balance: 9 });
    await expect(locator.commit(principal, retry, { targetCellIndex: 1 }))
      .resolves.toMatchObject({ status: 'committed', price: 1, balance: 9 });
    const rows = await dataSource.query<readonly { status: string }[]>(
      'SELECT status FROM economy.locator_attempts WHERE attempt_id = $1',
      [leftover],
    );
    expect(rows).toEqual([{ status: 'released' }]);
  });

  it('reports insufficient balance at the current price', async () => {
    await admin.update(operatorId, 5, null);
    const { principal, sessionId, patternId } = await guestWithSession(3);
    const error = await locator.prepare(principal, {
      attemptId: randomUUID(), sessionId, patternId, colorIndex: 0, dmcCode: '310', expectedPrice: 5,
    }).catch((caught: unknown) => caught);
    expect((error as ConflictException).getResponse()).toEqual({ code: 'insufficient_balance', price: 5, balance: 3 });
    expect(await balanceOf(principal)).toBe(3);
  });
});
