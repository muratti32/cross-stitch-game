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
