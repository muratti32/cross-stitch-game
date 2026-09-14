import { ConflictException } from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import {
  LocatorAttemptService,
  LOCATOR_PRICE_COIN,
} from './locator-attempt.service';

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
  };

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
      .mockResolvedValueOnce([{ balance: '0' }]);
    const { service } = makeService(query);

    await expect(service.prepare(principal, input)).rejects.toThrow(ConflictException);
    expect(query).toHaveBeenCalledTimes(6);
    expect(query.mock.calls.flat().join(' ')).not.toContain('coin_ledger_entries');
  });

  it('reserves one coin and returns a replayable prepared attempt', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const row = {
      attempt_id: input.attemptId,
      principal_type: 'guest', principal_id: principal.id,
      session_id: input.sessionId, pattern_id: input.patternId,
      color_index: 0, dmc_code: '310', target_cell_index: null,
      progress_revision: null, progress_hash: null, status: 'prepared',
      reserved_until: expiresAt, terminal_at: null,
    };
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ principal_type: 'guest', principal_id: principal.id, pattern_id: input.patternId, status: 'active' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ balance: '1' }])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const { service } = makeService(query);

    await expect(service.prepare(principal, input)).resolves.toMatchObject({
      attemptId: input.attemptId,
      status: 'prepared',
      price: LOCATOR_PRICE_COIN,
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
      progress_revision: null, progress_hash: null, status: 'prepared',
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
});
