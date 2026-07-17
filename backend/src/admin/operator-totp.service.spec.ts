import { authenticator } from 'otplib';

import { AppConfigService } from '../config/app-config.service';
import { OperatorTotpService } from './operator-totp.service';

describe('OperatorTotpService', () => {
  const config = {
    adminTotpIssuer: 'Stitch Wish Operator Console',
  } as unknown as AppConfigService;

  it('generates a secret and a scoped otpauth:// enrollment URI', () => {
    const service = new OperatorTotpService(config);
    const secret = service.generateSecret();

    expect(secret).toMatch(/^[A-Z2-7]+$/);
    const uri = service.keyUri('owner@example.test', secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(encodeURIComponent('Stitch Wish Operator Console'));
    expect(uri).toContain('owner%40example.test');
  });

  it('verifies a code generated from the same secret', () => {
    const service = new OperatorTotpService(config);
    const secret = service.generateSecret();
    const code = authenticator.generate(secret);

    expect(service.verify(code, secret)).toBe(true);
  });

  it('rejects a code generated from a different secret', () => {
    const service = new OperatorTotpService(config);
    const secretA = service.generateSecret();
    const secretB = service.generateSecret();
    const codeForB = authenticator.generate(secretB);

    expect(service.verify(codeForB, secretA)).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    const service = new OperatorTotpService(config);
    const secret = service.generateSecret();

    expect(service.verify('not-a-code', secret)).toBe(false);
    expect(service.verify('12345', secret)).toBe(false);
    expect(service.verify('', secret)).toBe(false);
  });
});
