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

describe('parseEnvironment OpenAI moderation', () => {
  it('keeps moderation enabled when the flag is omitted', () => {
    expect(
      parseEnvironment(validEnvironment()).OPENAI_MODERATION_ENABLED,
    ).toBe(true);
  });

  it('allows moderation to be disabled for local development', () => {
    expect(
      parseEnvironment(
        validEnvironment({
          OPENAI_MODERATION_ENABLED: 'false',
          NODE_ENV: 'development',
        }),
      ).OPENAI_MODERATION_ENABLED,
    ).toBe(false);
  });

  it('rejects disabling moderation in production', () => {
    expect(() =>
      parseEnvironment(
        validEnvironment({
          OPENAI_MODERATION_ENABLED: 'false',
          NODE_ENV: 'production',
        }),
      ),
    ).toThrow('OPENAI_MODERATION_ENABLED cannot be false in production');
  });

  it('rejects ambiguous flag values', () => {
    expect(() =>
      parseEnvironment(
        validEnvironment({ OPENAI_MODERATION_ENABLED: 'off' }),
      ),
    ).toThrow('OPENAI_MODERATION_ENABLED must be either true or false');
  });
});

describe('parseEnvironment R2 object storage', () => {
  it('leaves R2 fields undefined when omitted, keeping LocalObjectStorage active', () => {
    const result = parseEnvironment(validEnvironment());
    expect(result.R2_ACCOUNT_ID).toBeUndefined();
    expect(result.R2_ACCESS_KEY_ID).toBeUndefined();
    expect(result.R2_SECRET_ACCESS_KEY).toBeUndefined();
    expect(result.R2_BUCKET_NAME).toBeUndefined();
    expect(result.R2_PUBLIC_HOSTNAME).toBeUndefined();
  });

  it('accepts a fully configured R2 setup', () => {
    const result = parseEnvironment(
      validEnvironment({
        R2_ACCOUNT_ID: 'account123',
        R2_ACCESS_KEY_ID: 'key123',
        R2_SECRET_ACCESS_KEY: 'secret123',
        R2_BUCKET_NAME: 'stitch-wish-patterns',
        R2_PUBLIC_HOSTNAME: 'cdn.stitchwish.com',
      }),
    );
    expect(result.R2_ACCOUNT_ID).toBe('account123');
    expect(result.R2_ACCESS_KEY_ID).toBe('key123');
    expect(result.R2_SECRET_ACCESS_KEY).toBe('secret123');
    expect(result.R2_BUCKET_NAME).toBe('stitch-wish-patterns');
    expect(result.R2_PUBLIC_HOSTNAME).toBe('cdn.stitchwish.com');
  });

  it('rejects a partially configured R2 setup', () => {
    expect(() =>
      parseEnvironment(
        validEnvironment({
          R2_ACCOUNT_ID: 'account123',
          R2_BUCKET_NAME: 'stitch-wish-patterns',
        }),
      ),
    ).toThrow(
      'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME must all be set together to enable R2 object storage',
    );
  });
});
