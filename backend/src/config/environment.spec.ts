import { parseEnvironment, parseSentryEnvironment } from './environment';

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

  it('allows MFA to be disabled in production', () => {
    expect(
      parseEnvironment(
        validEnvironment({ ADMIN_MFA_ENABLED: 'false', NODE_ENV: 'production' }),
      ).ADMIN_MFA_ENABLED,
    ).toBe(false);
  });

  it('rejects ambiguous flag values', () => {
    expect(() =>
      parseEnvironment(validEnvironment({ ADMIN_MFA_ENABLED: 'off' })),
    ).toThrow('ADMIN_MFA_ENABLED must be either true or false');
  });
});

describe('parseEnvironment iOS guest commerce', () => {
  it('keeps guest commerce enabled by default for the current release', () => {
    expect(parseEnvironment(validEnvironment()).ENABLE_IOS_GUEST_COMMERCE).toBe(true);
  });

  it('supports an explicit rollout rollback', () => {
    expect(
      parseEnvironment(validEnvironment({ ENABLE_IOS_GUEST_COMMERCE: 'false' }))
        .ENABLE_IOS_GUEST_COMMERCE,
    ).toBe(false);
  });

  it('rejects ambiguous toggle values', () => {
    expect(() =>
      parseEnvironment(validEnvironment({ ENABLE_IOS_GUEST_COMMERCE: 'off' })),
    ).toThrow('ENABLE_IOS_GUEST_COMMERCE must be either true or false');
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

  it('allows moderation to be disabled in production', () => {
    expect(
      parseEnvironment(
        validEnvironment({
          OPENAI_MODERATION_ENABLED: 'false',
          NODE_ENV: 'production',
        }),
      ).OPENAI_MODERATION_ENABLED,
    ).toBe(false);
  });

  it('rejects ambiguous flag values', () => {
    expect(() =>
      parseEnvironment(
        validEnvironment({ OPENAI_MODERATION_ENABLED: 'off' }),
      ),
    ).toThrow('OPENAI_MODERATION_ENABLED must be either true or false');
  });
});

describe('parseSentryEnvironment', () => {
  it('leaves Sentry disabled when no DSN is configured', () => {
    expect(parseSentryEnvironment({})).toEqual({
      SENTRY_DSN: undefined,
      SENTRY_ENVIRONMENT: 'development',
      SENTRY_RELEASE: undefined,
      SENTRY_TRACES_SAMPLE_RATE: 1,
    });
  });

  it('requires a release whenever a DSN is configured', () => {
    expect(() =>
      parseSentryEnvironment({
        SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
      }),
    ).toThrow('SENTRY_RELEASE is required when SENTRY_DSN is configured');
  });

  it('uses the production tracing default and accepts a configured release', () => {
    expect(
      parseSentryEnvironment({
        NODE_ENV: 'production',
        SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
        SENTRY_RELEASE: 'stitch-wish-backend@0.1.0',
      }),
    ).toEqual({
      SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
      SENTRY_ENVIRONMENT: 'production',
      SENTRY_RELEASE: 'stitch-wish-backend@0.1.0',
      SENTRY_TRACES_SAMPLE_RATE: 0.2,
    });
  });
});

describe('parseEnvironment storage reconciler sweep', () => {
  it('keeps remote existence verification off unless it is explicitly enabled', () => {
    expect(
      parseEnvironment(validEnvironment()).STORAGE_OBJECT_VERIFICATION_ENABLED,
    ).toBe(false);
    expect(
      parseEnvironment(
        validEnvironment({ STORAGE_OBJECT_VERIFICATION_ENABLED: 'true' }),
      ).STORAGE_OBJECT_VERIFICATION_ENABLED,
    ).toBe(true);
  });

  it('rejects ambiguous verification toggle values', () => {
    expect(() =>
      parseEnvironment(
        validEnvironment({ STORAGE_OBJECT_VERIFICATION_ENABLED: 'off' }),
      ),
    ).toThrow('STORAGE_OBJECT_VERIFICATION_ENABLED must be either true or false');
  });

  it('defaults to a bounded five-minute sweep with a daily verification interval', () => {
    const result = parseEnvironment(validEnvironment());
    expect(result.STORAGE_RECONCILER_INTERVAL_SECONDS).toBe(300);
    expect(result.STORAGE_RECONCILER_BATCH_SIZE).toBe(250);
    expect(result.STORAGE_OBJECT_VERIFICATION_INTERVAL_SECONDS).toBe(86400);
  });

  it('accepts configured sweep bounds', () => {
    const result = parseEnvironment(
      validEnvironment({
        STORAGE_RECONCILER_INTERVAL_SECONDS: '600',
        STORAGE_RECONCILER_BATCH_SIZE: '50',
        STORAGE_OBJECT_VERIFICATION_INTERVAL_SECONDS: '43200',
      }),
    );
    expect(result.STORAGE_RECONCILER_INTERVAL_SECONDS).toBe(600);
    expect(result.STORAGE_RECONCILER_BATCH_SIZE).toBe(50);
    expect(result.STORAGE_OBJECT_VERIFICATION_INTERVAL_SECONDS).toBe(43200);
  });

  it('rejects a zero batch size, which would disable verification entirely', () => {
    expect(() =>
      parseEnvironment(validEnvironment({ STORAGE_RECONCILER_BATCH_SIZE: '0' })),
    ).toThrow('STORAGE_RECONCILER_BATCH_SIZE must be a positive integer');
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
