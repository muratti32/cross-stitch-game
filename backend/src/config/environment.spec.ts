import { parseEnvironment } from './environment';

function validEnvironment(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgresql://user:password@localhost:5432/stitch_wish',
    EMAIL_FROM_ADDRESS: 'dev@example.test',
    PORT: '3000',
    REDIS_URL: 'redis://localhost:6379',
    ...overrides,
  };
}

describe('parseEnvironment admin MFA', () => {
  it('keeps MFA enabled when the flag is omitted', () => {
    expect(parseEnvironment(validEnvironment()).ADMIN_MFA_ENABLED).toBe(true);
  });

  it('allows MFA to be disabled for local development', () => {
    expect(
      parseEnvironment(
        validEnvironment({ ADMIN_MFA_ENABLED: 'false', NODE_ENV: 'development' }),
      ).ADMIN_MFA_ENABLED,
    ).toBe(false);
  });

  it('rejects disabling MFA in production', () => {
    expect(() =>
      parseEnvironment(
        validEnvironment({ ADMIN_MFA_ENABLED: 'false', NODE_ENV: 'production' }),
      ),
    ).toThrow('ADMIN_MFA_ENABLED cannot be false in production');
  });

  it('rejects ambiguous flag values', () => {
    expect(() =>
      parseEnvironment(validEnvironment({ ADMIN_MFA_ENABLED: 'off' })),
    ).toThrow('ADMIN_MFA_ENABLED must be either true or false');
  });
});
