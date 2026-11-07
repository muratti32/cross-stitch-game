import { SessionsService } from './sessions.service';
import type { AppConfigService } from '../config/app-config.service';
import type { Repository, DataSource } from 'typeorm';
import type {
  SessionProgressFlagEntity,
  StitchingSessionEntity,
} from './entities';
import type { PatternEntity } from '../catalog/entities';
import type { CoinLedgerRepository } from '../economy/coin-ledger.repository';

function grantOnlyService(): SessionsService {
  const config = {
    grantTtlSeconds: 300,
    grantSigningSecret: 'unit-test-secret-not-a-real-one',
  } as AppConfigService;
  return new SessionsService(
    null as unknown as Repository<StitchingSessionEntity>,
    null as unknown as Repository<SessionProgressFlagEntity>,
    null as unknown as Repository<PatternEntity>,
    config,
    null as unknown as DataSource,
    null as unknown as CoinLedgerRepository,
  );
}

describe('Artifact Access Grant signing', () => {
  const patternId = '0d9f7c9a-1111-4222-8333-444455556666';

  it('accepts a freshly signed grant', () => {
    const service = grantOnlyService();
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = service.signGrant(patternId, exp);
    expect(service.verifyGrant(patternId, exp, sig)).toBe(true);
  });

  it('rejects an expired grant even with a valid signature', () => {
    const service = grantOnlyService();
    const exp = Math.floor(Date.now() / 1000) - 1;
    const sig = service.signGrant(patternId, exp);
    expect(service.verifyGrant(patternId, exp, sig)).toBe(false);
  });

  it('rejects tampered pattern ids, expiries, and signatures', () => {
    const service = grantOnlyService();
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = service.signGrant(patternId, exp);

    expect(
      service.verifyGrant('9d9f7c9a-1111-4222-8333-444455556666', exp, sig),
    ).toBe(false);
    expect(service.verifyGrant(patternId, exp + 60, sig)).toBe(false);
    const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    expect(service.verifyGrant(patternId, exp, flipped)).toBe(false);
    expect(service.verifyGrant(patternId, exp, 'deadbeef')).toBe(false);
    expect(service.verifyGrant(patternId, exp, 'not-hex-at-all')).toBe(false);
  });
});

describe('SessionsService.cancelSession', () => {
  const sessionId = '0d9f7c9a-1111-4222-8333-444455556666';
  const principal = { id: 'owner-1', type: 'account', tokenVersion: 0 } as never;

  function cancelHarness(flag: { hasAnyProgress: boolean } | null) {
    const manager = {
      findOne: jest.fn(async (entity: { name: string }) => {
        await Promise.resolve();
        if (entity.name === 'StitchingSessionEntity') {
          return { id: sessionId, principalId: 'owner-1', principalType: 'account' };
        }
        return flag;
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: (callback: (value: typeof manager) => Promise<unknown>) => callback(manager),
    };
    const service = new SessionsService(
      null as unknown as Repository<StitchingSessionEntity>,
      null as unknown as Repository<SessionProgressFlagEntity>,
      null as unknown as Repository<PatternEntity>,
      {} as AppConfigService,
      dataSource as unknown as DataSource,
      null as unknown as CoinLedgerRepository,
    );
    return { manager, service };
  }

  it('keeps a session whose progress flag is set', async () => {
    const { manager, service } = cancelHarness({ hasAnyProgress: true });
    await service.cancelSession(principal, sessionId);
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('deletes a session whose progress flag is false', async () => {
    const { manager, service } = cancelHarness({ hasAnyProgress: false });
    await service.cancelSession(principal, sessionId);
    expect(manager.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes a session with no progress flag row', async () => {
    const { manager, service } = cancelHarness(null);
    await service.cancelSession(principal, sessionId);
    expect(manager.delete).toHaveBeenCalledTimes(1);
  });
});

describe('SessionsService.refreshGrant', () => {
  const sessionId = '0d9f7c9a-1111-4222-8333-444455556666';
  const principal = { id: 'owner-1', type: 'account', tokenVersion: 0 } as never;

  function refreshHarness(unlockPriceTier: number | null, owned: boolean) {
    const session = {
      id: sessionId,
      patternId: 'pattern-1',
      principalId: 'owner-1',
      principalType: 'account',
      status: 'active',
    };
    const pattern = {
      id: 'pattern-1',
      status: 'available',
      visibility: 'catalog',
      unlockPriceTier,
      artifactByteLength: 10,
      artifactChecksum: 'abc',
      artifactSchemaVersion: 1,
    };
    const manager = {
      getRepository: (entity: { name: string }) => ({
        findOne: jest.fn(async () => {
          await Promise.resolve();
          return entity.name === 'StitchingSessionEntity' ? session : pattern;
        }),
      }),
    };
    const dataSource = {
      transaction: (callback: (value: typeof manager) => Promise<unknown>) => callback(manager),
    };
    const coinLedger = { isPatternUnlocked: jest.fn().mockResolvedValue(owned) };
    const service = new SessionsService(
      null as unknown as Repository<StitchingSessionEntity>,
      null as unknown as Repository<SessionProgressFlagEntity>,
      null as unknown as Repository<PatternEntity>,
      {
        grantTtlSeconds: 300,
        grantSigningSecret: 'unit-test-secret-not-a-real-one',
      } as AppConfigService,
      dataSource as unknown as DataSource,
      coinLedger as unknown as CoinLedgerRepository,
    );
    return { coinLedger, service };
  }

  it('rejects a locked paid pattern with unlock_required', async () => {
    const { service } = refreshHarness(1, false);
    await expect(service.refreshGrant(principal, sessionId)).rejects.toMatchObject({
      response: { code: 'unlock_required', patternId: 'pattern-1' },
    });
  });

  it('returns a grant for a free pattern without consulting the ledger', async () => {
    const { coinLedger, service } = refreshHarness(null, false);
    const result = await service.refreshGrant(principal, sessionId);
    expect(result.grant.url).toContain('/v1/artifacts/pattern-1');
    expect(coinLedger.isPatternUnlocked).not.toHaveBeenCalled();
  });

  it('returns a grant for an unlocked paid pattern', async () => {
    const { service } = refreshHarness(1, true);
    const result = await service.refreshGrant(principal, sessionId);
    expect(result.sessionId).toBe(sessionId);
  });
});
