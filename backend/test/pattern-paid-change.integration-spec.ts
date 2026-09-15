import 'reflect-metadata';

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { OperatorAuditLogService } from '../src/admin/operator-audit-log.service';
import { PatternPaidAdminService } from '../src/admin/pattern-paid-admin.service';
import type { AuthPrincipal } from '../src/auth/auth.types';
import { PrincipalType } from '../src/auth/entities';
import { PatternEntity } from '../src/catalog/entities';
import type { AppConfigService } from '../src/config/app-config.service';
import { createTypeOrmOptions } from '../src/database/typeorm-options';
import { CoinLedgerRepository } from '../src/economy/coin-ledger.repository';
import {
  SessionProgressFlagEntity,
  StitchingSessionEntity,
} from '../src/sessions/entities';
import { SessionsService } from '../src/sessions/sessions.service';

interface PatternFixture {
  patternId: string;
}

interface UnlockRow {
  principal_type: string;
  principal_id: string;
  source: string;
}

interface AuditRow {
  action: string;
  before: { unlockPriceTier: string | null };
  after: {
    unlockPriceTier: string | null;
    paid: boolean;
    grandfatheredCount: number;
  };
}

interface CountRow {
  count: string;
}

describe('Official Pattern paid-state changes', () => {
  let dataSource: DataSource;
  let admin: PatternPaidAdminService;
  let sessions: SessionsService;
  let operatorId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL is not set by global setup');
    }

    dataSource = new DataSource(createTypeOrmOptions(url));
    await dataSource.initialize();

    admin = new PatternPaidAdminService(
      dataSource,
      new OperatorAuditLogService(),
    );
    const coinLedger = new CoinLedgerRepository(dataSource);
    sessions = new SessionsService(
      dataSource.getRepository(StitchingSessionEntity),
      dataSource.getRepository(SessionProgressFlagEntity),
      dataSource.getRepository(PatternEntity),
      {
        grantSigningSecret: 'pattern-paid-integration-secret',
        grantTtlSeconds: 300,
      } as AppConfigService,
      dataSource,
      coinLedger,
    );

    const operators = await dataSource.query<readonly { id: string }[]>(
      `INSERT INTO admin.operator_accounts
         (email, password_hash, totp_secret_encrypted)
       VALUES ($1, 'integration-only', 'integration-only')
       RETURNING id`,
      [`pattern-paid-${randomUUID()}@example.test`],
    );
    operatorId = operators[0].id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  async function createPattern(options?: {
    draft?: boolean;
    status?: 'available' | 'removed';
    tier?: 'small' | 'medium' | 'large' | null;
  }): Promise<PatternFixture> {
    const patternId = randomUUID();
    const suffix = randomUUID();
    await dataSource.query(
      `INSERT INTO catalog.patterns
         (id, title, description, creator_name, category_code, width, height,
          palette_size, artifact_object_key, artifact_checksum,
          artifact_byte_length, artifact_schema_version, preview_object_key,
          visibility, status, unlock_price_tier, creator_profile_id)
       VALUES
         ($1, 'Pattern Paid', 'Pattern Paid fixture.', 'Stitch Wish', 'other',
          100, 50, 12, $2, $3, 100, 1, $4, 'catalog', $5, $6, NULL)`,
      [
        patternId,
        `official/pattern-paid-${suffix}.bin`,
        'a'.repeat(64),
        `official/pattern-paid-${suffix}.png`,
        options?.status ?? 'available',
        options?.tier ?? null,
      ],
    );

    if (options?.draft !== false) {
      await dataSource.query(
        `INSERT INTO admin.official_pattern_drafts
           (created_by_operator_id, status, source_object_key, source_checksum,
            source_byte_length, source_content_type, source_width,
            source_height, short_edge_cells, max_colors,
            stitchable_cell_count, published_pattern_id)
         VALUES
           ($1, 'published', $2, $3, 100, 'image/png', 100, 50, 50, 12,
            5000, $4)`,
        [
          operatorId,
          `official/source-${suffix}.png`,
          'b'.repeat(64),
          patternId,
        ],
      );
    }

    return { patternId };
  }

  async function createAccount(): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      'INSERT INTO auth.registered_accounts (id) VALUES ($1)',
      [id],
    );
    return id;
  }

  async function createGuest(): Promise<string> {
    const id = randomUUID();
    const suffix = randomUUID().replaceAll('-', '');
    await dataSource.query(
      `INSERT INTO auth.guest_installations
         (id, installation_key_hash, credential_hash)
       VALUES ($1, $2, 'integration-only')`,
      [id, suffix.padEnd(64, '0')],
    );
    return id;
  }

  async function createSession(
    principalType: 'guest' | 'account',
    principalId: string,
    patternId: string,
    status: 'active' | 'completed',
  ): Promise<string> {
    const rows = await dataSource.query<readonly { id: string }[]>(
      `INSERT INTO sessions.stitching_sessions
         (principal_type, principal_id, pattern_id, status, completed_at)
       VALUES ($1, $2, $3, $4::varchar, CASE WHEN $4::varchar = 'completed' THEN now() END)
       RETURNING id`,
      [principalType, principalId, patternId, status],
    );
    return rows[0].id;
  }

  async function auditRows(patternId: string): Promise<readonly AuditRow[]> {
    return dataSource.query<readonly AuditRow[]>(
      `SELECT action, before, after
       FROM admin.operator_audit_log
       WHERE operator_account_id = $1
         AND target_id = $2
         AND action = 'pattern.paid_change'
       ORDER BY created_at, id`,
      [operatorId, patternId],
    );
  }

  async function unlockRows(
    patternId: string,
  ): Promise<readonly UnlockRow[]> {
    return dataSource.query<readonly UnlockRow[]>(
      `SELECT principal_type, principal_id, source
       FROM economy.pattern_unlocks
       WHERE pattern_id = $1
       ORDER BY principal_type, principal_id`,
      [patternId],
    );
  }

  async function ledgerCount(
    principalIds: readonly string[],
  ): Promise<number> {
    const rows = await dataSource.query<readonly CountRow[]>(
      `SELECT count(*)::text AS count
       FROM economy.coin_ledger_entries
       WHERE principal_id = ANY($1::uuid[])`,
      [principalIds],
    );
    return Number(rows[0].count);
  }

  function accountPrincipal(id: string): AuthPrincipal {
    return { id, type: PrincipalType.Account, tokenVersion: 1 };
  }

  it('grandfathers sessions, preserves provenance, and remains idempotent across flips', async () => {
    const { patternId } = await createPattern();
    const activeAccountId = await createAccount();
    const completedGuestId = await createGuest();
    const coinSpendAccountId = await createAccount();
    const noSessionAccountId = await createAccount();

    await createSession('account', activeAccountId, patternId, 'active');
    await createSession('guest', completedGuestId, patternId, 'completed');
    await createSession('account', coinSpendAccountId, patternId, 'active');
    await dataSource.query(
      `INSERT INTO economy.pattern_unlocks
         (principal_type, principal_id, pattern_id, source)
       VALUES ('account', $1, $2, 'coin_spend')`,
      [coinSpendAccountId, patternId],
    );

    await expect(
      admin.setPatternPaid(
        operatorId,
        patternId,
        true,
        `paid-${randomUUID()}`,
      ),
    ).resolves.toEqual({
      patternId,
      changed: true,
      beforeTier: null,
      afterTier: 'medium',
      grandfatheredCount: 2,
    });

    expect(await unlockRows(patternId)).toEqual(
      expect.arrayContaining([
        {
          principal_type: 'account',
          principal_id: activeAccountId,
          source: 'grandfathered',
        },
        {
          principal_type: 'guest',
          principal_id: completedGuestId,
          source: 'grandfathered',
        },
        {
          principal_type: 'account',
          principal_id: coinSpendAccountId,
          source: 'coin_spend',
        },
      ]),
    );
    expect(await unlockRows(patternId)).toHaveLength(3);
    expect(
      await ledgerCount([
        activeAccountId,
        completedGuestId,
        coinSpendAccountId,
      ]),
    ).toBe(0);

    expect(await auditRows(patternId)).toEqual([
      {
        action: 'pattern.paid_change',
        before: { unlockPriceTier: null },
        after: {
          unlockPriceTier: 'medium',
          paid: true,
          grandfatheredCount: 2,
        },
      },
    ]);

    await expect(
      sessions.prepareSession(accountPrincipal(activeAccountId), patternId),
    ).resolves.toMatchObject({ patternId });

    const locked = await sessions
      .prepareSession(accountPrincipal(noSessionAccountId), patternId)
      .catch((error: unknown) => error);
    expect(locked).toBeInstanceOf(ForbiddenException);
    expect((locked as ForbiddenException).getResponse()).toEqual({
      code: 'unlock_required',
      patternId,
      price: 150,
    });

    await expect(
      admin.setPatternPaid(operatorId, patternId, true, null),
    ).resolves.toEqual({
      patternId,
      changed: false,
      beforeTier: 'medium',
      afterTier: 'medium',
      grandfatheredCount: 0,
    });
    expect(await unlockRows(patternId)).toHaveLength(3);
    expect(await auditRows(patternId)).toHaveLength(1);

    await expect(
      admin.setPatternPaid(operatorId, patternId, false, null),
    ).resolves.toEqual({
      patternId,
      changed: true,
      beforeTier: 'medium',
      afterTier: null,
      grandfatheredCount: 0,
    });
    const afterFree = await unlockRows(patternId);
    expect(afterFree).toHaveLength(3);
    expect(afterFree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principal_id: coinSpendAccountId,
          source: 'coin_spend',
        }),
        expect.objectContaining({
          principal_id: activeAccountId,
          source: 'grandfathered',
        }),
      ]),
    );
    expect(await ledgerCount([activeAccountId, completedGuestId])).toBe(0);
    expect(await auditRows(patternId)).toHaveLength(2);

    const newGuestId = await createGuest();
    await createSession('guest', newGuestId, patternId, 'active');
    await expect(
      admin.setPatternPaid(operatorId, patternId, true, null),
    ).resolves.toEqual({
      patternId,
      changed: true,
      beforeTier: null,
      afterTier: 'medium',
      grandfatheredCount: 1,
    });

    const afterSecondPaid = await unlockRows(patternId);
    expect(afterSecondPaid).toHaveLength(4);
    expect(afterSecondPaid).toEqual(
      expect.arrayContaining([
        {
          principal_type: 'guest',
          principal_id: newGuestId,
          source: 'grandfathered',
        },
        {
          principal_type: 'account',
          principal_id: coinSpendAccountId,
          source: 'coin_spend',
        },
      ]),
    );
    expect(await ledgerCount([newGuestId])).toBe(0);
    expect(await auditRows(patternId)).toHaveLength(3);
  });

  it('commits eligible bulk changes while reporting independent failures', async () => {
    const eligible = await createPattern();
    const removed = await createPattern({ status: 'removed' });
    const unknownId = randomUUID();

    const result = await admin.setPatternsPaid(
      operatorId,
      [removed.patternId, unknownId, eligible.patternId],
      true,
      `bulk-${randomUUID()}`,
    );

    expect(result.paid).toBe(true);
    expect(result.results).toEqual(
      [...result.results].sort((left, right) =>
        left.patternId.localeCompare(right.patternId),
      ),
    );
    expect(result.results).toEqual(
      expect.arrayContaining([
        {
          patternId: eligible.patternId,
          outcome: 'changed',
          beforeTier: null,
          afterTier: 'medium',
          grandfatheredCount: 0,
        },
        {
          patternId: unknownId,
          outcome: 'failed',
          errorCode: 'pattern_not_found',
        },
        {
          patternId: removed.patternId,
          outcome: 'failed',
          errorCode: 'pattern_not_eligible',
        },
      ]),
    );

    const tiers = await dataSource.query<
      readonly { id: string; unlock_price_tier: string | null }[]
    >(
      `SELECT id, unlock_price_tier
       FROM catalog.patterns
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [[eligible.patternId, removed.patternId]],
    );
    expect(tiers).toEqual(
      expect.arrayContaining([
        { id: eligible.patternId, unlock_price_tier: 'medium' },
        { id: removed.patternId, unlock_price_tier: null },
      ]),
    );
    expect(await auditRows(eligible.patternId)).toHaveLength(1);
    expect(await auditRows(removed.patternId)).toHaveLength(0);
  });

  it('grandfathers a session committed while the paid change waits for the Pattern lock', async () => {
    const { patternId } = await createPattern();
    const accountId = await createAccount();
    const queryRunner = dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.query(
        'SELECT id FROM catalog.patterns WHERE id = $1 FOR UPDATE',
        [patternId],
      );
      await queryRunner.query(
        `INSERT INTO sessions.stitching_sessions
           (principal_type, principal_id, pattern_id, status)
         VALUES ('account', $1, $2, 'active')`,
        [accountId, patternId],
      );

      let settled = false;
      const flip = admin.setPatternPaid(
        operatorId,
        patternId,
        true,
        `concurrent-${randomUUID()}`,
      );
      void flip.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      expect(settled).toBe(false);

      await queryRunner.commitTransaction();
      await expect(flip).resolves.toEqual({
        patternId,
        changed: true,
        beforeTier: null,
        afterTier: 'medium',
        grandfatheredCount: 1,
      });
    } finally {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      await queryRunner.release();
    }

    expect(await unlockRows(patternId)).toContainEqual({
      principal_type: 'account',
      principal_id: accountId,
      source: 'grandfathered',
    });
  });

  it('rejects paid conversion when stitchable-cell count is unavailable', async () => {
    const { patternId } = await createPattern({ draft: false });

    const error = await admin
      .setPatternPaid(operatorId, patternId, true, `missing-${randomUUID()}`)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'stitchable_cell_count_unknown',
    });
    const patterns = await dataSource.query<
      readonly { unlock_price_tier: string | null }[]
    >(
      'SELECT unlock_price_tier FROM catalog.patterns WHERE id = $1',
      [patternId],
    );
    expect(patterns).toEqual([{ unlock_price_tier: null }]);
    expect(await auditRows(patternId)).toHaveLength(0);
  });

  it('enforces the unlock-source migration default and check constraint', async () => {
    const { patternId } = await createPattern();
    const defaultPrincipalId = await createAccount();
    const invalidPrincipalId = await createGuest();

    await dataSource.query(
      `INSERT INTO economy.pattern_unlocks
         (principal_type, principal_id, pattern_id)
       VALUES ('account', $1, $2)`,
      [defaultPrincipalId, patternId],
    );
    const rows = await dataSource.query<readonly { source: string }[]>(
      `SELECT source
       FROM economy.pattern_unlocks
       WHERE principal_type = 'account'
         AND principal_id = $1
         AND pattern_id = $2`,
      [defaultPrincipalId, patternId],
    );
    expect(rows).toEqual([{ source: 'coin_spend' }]);

    await expect(
      dataSource.query(
        `INSERT INTO economy.pattern_unlocks
           (principal_type, principal_id, pattern_id, source)
         VALUES ('guest', $1, $2, 'bogus')`,
        [invalidPrincipalId, patternId],
      ),
    ).rejects.toThrow();
  });
});