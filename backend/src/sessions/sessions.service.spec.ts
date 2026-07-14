import { SessionsService } from './sessions.service';
import type { AppConfigService } from '../config/app-config.service';
import type { Repository, DataSource } from 'typeorm';
import type {
  SessionProgressFlagEntity,
  StitchingSessionEntity,
} from './entities';
import type { PatternEntity } from '../catalog/entities';

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
