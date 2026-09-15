import { ConflictException } from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { LocatorAttemptService } from './locator-attempt.service';

describe('LocatorAttemptService', () => {
  const principal: AuthPrincipal = {
    id: '11111111-1111-4111-8111-111111111111',
    type: PrincipalType.Guest,
    tokenVersion: 1,
  };
  const input = {
    attemptId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    patternId: '44444444-4444-4444-8444-444444444444',
    colorIndex: 0,
    dmcCode: '310',
    expectedPrice: 1,
  };
  const priceRow = (price: number) => [{ price_coin: price, updated_at: new Date(), updated_by_operator_id: null }];

  function makeService(query: jest.Mock) {
    const manager = { query };
    const dataSource = {
      transaction: jest.fn((callback: (tx: typeof manager) => unknown) => Promise.resolve(callback(manager))),
    };
    return { service: new LocatorAttemptService(dataSource as never), manager };
  }

  it('rejects prepare without charging when spendable balance is insufficient', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([]) // expire
      .mockResolvedValueOnce([]) // attempt idempotency lookup
      .mockResolvedValueOnce([{ principal_type: 'guest', principal_id: principal.id, pattern_id: input.patternId, status: 'active' }]) // session
      .mockResolvedValueOnce([]) // active attempt
      .mockResolvedValueOnce([{ count: '0' }]) // rate limit
      .mockResolvedValueOnce([{ balance: '0' }])
      .mockResolvedValueOnce(priceRow(1));
    const { service } = makeService(query);

    await expect(service.prepare(principal, input)).rejects.toThrow(ConflictException);
    expect(query).toHaveBeenCalledTimes(7);
    expect(query.mock.calls.flat().join(' ')).not.toContain('coin_ledger_entries');
  });

  it('reserves one coin and returns a replayable prepared attempt', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const row = {
      attempt_id: input.attemptId,
      principal_type: 'guest', principal_id: principal.id,
      session_id: input.sessionId, pattern_id: input.patternId,
      color_index: 0, dmc_code: '310', target_cell_index: null,
      progress_revision: null, progress_hash: null, reserved_price: 1, status: 'prepared',
      reserved_until: expiresAt, terminal_at: null,
    };
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ principal_type: 'guest', principal_id: principal.id, pattern_id: input.patternId, status: 'active' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ balance: '1' }])
      .mockResolvedValueOnce(priceRow(1))
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const { service } = makeService(query);

    await expect(service.prepare(principal, input)).resolves.toMatchObject({
      attemptId: input.attemptId,
      status: 'prepared',
      price: 1,
      balance: 0,
    });
    expect(query.mock.calls.flat().join(' ')).toContain('locator:22222222-2222-4222-8222-222222222222:reserve');
  });

  it('commits exactly once and replays a committed result without a second debit', async () => {
    const row = {
      attempt_id: input.attemptId,
      principal_type: 'guest', principal_id: principal.id,
      session_id: input.sessionId, pattern_id: input.patternId,
      color_index: 0, dmc_code: '310', target_cell_index: null,
      progress_revision: null, progress_hash: null, reserved_price: 1, status: 'prepared',
      reserved_until: new Date(Date.now() + 60_000), terminal_at: null,
    };
    const committed = { ...row, status: 'committed', target_cell_index: 7 };
    const query = jest.fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([committed])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ balance: '0' }]);
    const { service } = makeService(query);

    await expect(service.commit(principal, input.attemptId, { targetCellIndex: 7 })).resolves.toMatchObject({
      status: 'committed', targetCellIndex: 7, balance: 0,
    });
    const replayed = { ...committed, target_cell_index: 7 };
    query.mockResolvedValueOnce([replayed]).mockResolvedValueOnce([{ balance: '0' }]);
    await expect(service.commit(principal, input.attemptId, { targetCellIndex: 7 })).resolves.toMatchObject({
      status: 'committed', targetCellIndex: 7, balance: 0,
    });
    const calls = query.mock.calls.flat().join(' ');
    expect(calls).toContain('locator:22222222-2222-4222-8222-222222222222:commit');
    expect(calls.match(/locator:22222222-2222-4222-8222-222222222222:commit/g)).toHaveLength(1);
  });

  it('compensates a commit that races a client cancellation', async () => {
    const committed = {
      attempt_id: input.attemptId,
      principal_type: 'guest', principal_id: principal.id,
      session_id: input.sessionId, pattern_id: input.patternId,
      color_index: 0, dmc_code: '310', target_cell_index: 7,
      progress_revision: null, progress_hash: null,
      reserved_price: 1, reserved_paid_amount: '0', status: 'committed',
      reserved_until: new Date(Date.now() + 60_000), terminal_at: null,
    };
    const released = { ...committed, status: 'released' };
    const query = jest.fn()
      .mockResolvedValueOnce([committed])
      .mockResolvedValueOnce([released])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ balance: '1' }]);
    const { service } = makeService(query);

    await expect(service.release(principal, input.attemptId, { cancellation: true })).resolves.toMatchObject({
      status: 'released', balance: 1,
    });
    const releaseCall = (query.mock.calls as unknown[][]).find((call) => {
      const params = call[1];
      return Array.isArray(params) && params.some((value: unknown) => value === `locator:${input.attemptId}:release`);
    });
    const releaseParams = releaseCall?.[1] as readonly unknown[] | undefined;
    expect(releaseParams?.at(-1)).toMatchObject({ action: 'cancel_after_commit' });
    expect(query.mock.calls.flat().join(' ')).toContain('locator:22222222-2222-4222-8222-222222222222:release');
  });
  it('rejects a stale expected Locator Price without reserving or charging', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ principal_type: 'guest', principal_id: principal.id, pattern_id: input.patternId, status: 'active' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ balance: '20', paid_balance: '0' }])
      .mockResolvedValueOnce(priceRow(3));
    const { service } = makeService(query);

    const error = await service.prepare(principal, input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({ code: 'locator_price_changed', price: 3, balance: 20 });
    const sql = query.mock.calls.map((call: unknown[]) => String(call[0])).join(' ');
    expect(sql).toContain('FOR SHARE');
    expect(sql).not.toContain('INSERT INTO economy.locator_attempts');
    expect(sql).not.toContain('coin_ledger_entries');
  });

  it('reserves at the current Locator Price and locks it on the attempt', async () => {
    const row = {
      attempt_id: input.attemptId,
      principal_type: 'guest', principal_id: principal.id,
      session_id: input.sessionId, pattern_id: input.patternId,
      color_index: 0, dmc_code: '310', target_cell_index: null,
      progress_revision: null, progress_hash: null, reserved_price: 3,
      reserved_paid_amount: '0', status: 'prepared',
      reserved_until: new Date(Date.now() + 60_000), terminal_at: null,
    };
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ principal_type: 'guest', principal_id: principal.id, pattern_id: input.patternId, status: 'active' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ balance: '5', paid_balance: '0' }])
      .mockResolvedValueOnce(priceRow(3))
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const { service } = makeService(query);

    await expect(service.prepare(principal, { ...input, expectedPrice: 3 })).resolves.toMatchObject({ price: 3, balance: 2 });
    const insert = (query.mock.calls as unknown[][]).find((call) => String(call[0]).includes('INSERT INTO economy.locator_attempts'));
    expect((insert?.[1] as unknown[])[9]).toBe(3);
    const debit = (query.mock.calls as unknown[][]).find((call) => String(call[0]).includes('balance = balance - $3'));
    expect((debit?.[1] as unknown[])[2]).toBe(3);
  });

  it('commits and releases with the locked price even after the global price changes', async () => {
    const prepared = {
      attempt_id: input.attemptId,
      principal_type: 'guest', principal_id: principal.id,
      session_id: input.sessionId, pattern_id: input.patternId,
      color_index: 0, dmc_code: '310', target_cell_index: null,
      progress_revision: null, progress_hash: null, reserved_price: 4,
      reserved_paid_amount: '0', status: 'prepared',
      reserved_until: new Date(Date.now() + 60_000), terminal_at: null,
    };
    const committed = { ...prepared, status: 'committed', target_cell_index: 7 };
    const query = jest.fn()
      .mockResolvedValueOnce([prepared])
      .mockResolvedValueOnce([committed])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ balance: '6' }])
      .mockResolvedValueOnce([committed])
      .mockResolvedValueOnce([{ ...committed, status: 'released' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ balance: '10' }]);
    const { service } = makeService(query);

    await expect(service.commit(principal, input.attemptId, { targetCellIndex: 7 })).resolves.toMatchObject({ price: 4 });
    await expect(service.release(principal, input.attemptId, { cancellation: true })).resolves.toMatchObject({ price: 4, balance: 10 });
    const calls = query.mock.calls as unknown[][];
    const commitLedger = calls.find((call) => (call[1] as unknown[] | undefined)?.includes(`locator:${input.attemptId}:commit`));
    expect((commitLedger?.[1] as unknown[])[2]).toBe(-4);
    const refund = calls.find((call) => String(call[0]).includes('balance = balance + $3'));
    expect((refund?.[1] as unknown[])[2]).toBe(4);
    const releaseLedger = calls.find((call) => (call[1] as unknown[] | undefined)?.includes(`locator:${input.attemptId}:release`));
    expect((releaseLedger?.[1] as unknown[])[2]).toBe(4);
    expect(calls.map((call) => String(call[0])).join(' ')).not.toContain('locator_price_setting');
  });
  it('reads commit results from the PostgreSQL UPDATE ... RETURNING [rows, count] shape', async () => {
    const prepared = {
      attempt_id: input.attemptId,
      principal_type: 'guest', principal_id: principal.id,
      session_id: input.sessionId, pattern_id: input.patternId,
      color_index: 0, dmc_code: '310', target_cell_index: null,
      progress_revision: null, progress_hash: null, reserved_price: 2,
      reserved_paid_amount: '0', status: 'prepared',
      reserved_until: new Date(Date.now() + 60_000), terminal_at: null,
    };
    const committed = { ...prepared, status: 'committed', target_cell_index: 5 };
    const query = jest.fn()
      .mockResolvedValueOnce([prepared])
      .mockResolvedValueOnce([[committed], 1])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ balance: '8' }]);
    const { service } = makeService(query);

    await expect(service.commit(principal, input.attemptId, { targetCellIndex: 5 })).resolves.toEqual({
      attemptId: input.attemptId,
      status: 'committed',
      price: 2,
      balance: 8,
      expiresAt: prepared.reserved_until.toISOString(),
      targetCellIndex: 5,
    });
  });
  it('releases an open hold at a superseded price instead of charging it to a player shown the new price', async () => {
    const stale = {
      attempt_id: '55555555-5555-4555-8555-555555555555',
      principal_type: 'guest', principal_id: principal.id,
      session_id: input.sessionId, pattern_id: input.patternId,
      color_index: 0, dmc_code: '310', target_cell_index: null,
      progress_revision: null, progress_hash: null, reserved_price: 5,
      reserved_paid_amount: '0', status: 'prepared',
      reserved_until: new Date(Date.now() + 60_000), terminal_at: null,
    };
    const fresh = { ...stale, attempt_id: input.attemptId, reserved_price: 1 };
    const query = jest.fn()
      .mockResolvedValueOnce([]) // expire
      .mockResolvedValueOnce([]) // idempotency lookup
      .mockResolvedValueOnce([{ principal_type: 'guest', principal_id: principal.id, pattern_id: input.patternId, status: 'active' }])
      .mockResolvedValueOnce([stale]) // active prepared attempt at the old price
      .mockResolvedValueOnce([[{ ...stale, status: 'released' }], 1]) // release
      .mockResolvedValueOnce([]) // refund balance
      .mockResolvedValueOnce([]) // release ledger
      .mockResolvedValueOnce([{ balance: '10' }]) // release view balance
      .mockResolvedValueOnce([{ count: '1' }]) // rate limit
      .mockResolvedValueOnce([{ balance: '10', paid_balance: '0' }])
      .mockResolvedValueOnce(priceRow(1))
      .mockResolvedValueOnce([fresh])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const { service } = makeService(query);

    await expect(service.prepare(principal, input)).resolves.toMatchObject({ attemptId: input.attemptId, price: 1, balance: 9 });
    const calls = query.mock.calls as unknown[][];
    const refund = calls.find((call) => String(call[0]).includes('balance = balance + $3'));
    expect((refund?.[1] as unknown[])[2]).toBe(5);
    expect(calls.some((call) => (call[1] as unknown[] | undefined)?.includes(`locator:${stale.attempt_id}:commit`))).toBe(false);
  });

  it('replays an open hold whose locked price matches the expected price', async () => {
    const active = {
      attempt_id: '55555555-5555-4555-8555-555555555555',
      principal_type: 'guest', principal_id: principal.id,
      session_id: input.sessionId, pattern_id: input.patternId,
      color_index: 0, dmc_code: '310', target_cell_index: null,
      progress_revision: null, progress_hash: null, reserved_price: 1,
      reserved_paid_amount: '0', status: 'prepared',
      reserved_until: new Date(Date.now() + 60_000), terminal_at: null,
    };
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ principal_type: 'guest', principal_id: principal.id, pattern_id: input.patternId, status: 'active' }])
      .mockResolvedValueOnce([active])
      .mockResolvedValueOnce([{ balance: '9' }]);
    const { service } = makeService(query);

    await expect(service.prepare(principal, input)).resolves.toMatchObject({ attemptId: active.attempt_id, price: 1, balance: 9 });
    expect(query).toHaveBeenCalledTimes(5);
  });
});
