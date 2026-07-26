export function seedTestEnvironment(): void {
  // NODE_ENV must always be set to test under test execution
  process.env.NODE_ENV = 'test';

  const defaultEnv: Record<string, string> = {
    DATABASE_URL: 'postgresql://stitch_wish_test:stitch_wish_test@localhost:5432/stitch_wish_test',
    REDIS_URL: 'redis://localhost:6379',
    CONVERSION_ENGINE_URL: 'http://localhost:8000',
    CONVERSION_WORKER_CONCURRENCY: '2',
    PORT: '3000',
    JWT_SECRET: 'integration-test-only-jwt-secret-at-least-32-chars',
    JWT_ACCESS_TTL_SECONDS: '900',
    REFRESH_TOKEN_TTL_SECONDS: '3600',
    STORAGE_LOCAL_DIR: './storage-test',
    GRANT_TTL_SECONDS: '300',
    GRANT_SIGNING_SECRET: 'integration-test-only-grant-signing-secret-at-least-32-chars',
    OTP_SIGNING_SECRET: 'integration-test-only-otp-signing-secret-at-least-32-chars',
    EMAIL_FROM_ADDRESS: 'test@example.com',
    EMAIL_OTP_TTL_SECONDS: '600',
    EMAIL_OTP_MAX_ATTEMPTS: '5',
    EMAIL_OTP_RATE_LIMIT_PER_EMAIL: '100000',
    EMAIL_OTP_RATE_LIMIT_PER_IP: '100000',
    ADMIN_JWT_SECRET: 'integration-test-only-admin-jwt-secret-at-least-32-chars',
    ADMIN_JWT_ACCESS_TTL_SECONDS: '900',
    ADMIN_REFRESH_TOKEN_TTL_SECONDS: '43200',
    ADMIN_MFA_ENABLED: 'false',
    ADMIN_TOTP_ENC_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
    ADMIN_TOTP_ISSUER: 'Stitch Wish Test',
    AD_ATTEMPT_TTL_SECONDS: '300',
    OPENAI_MODERATION_ENABLED: 'false',
    WEBHOOK_ARCHIVE_RETENTION_SECONDS: '2592000',
    WEBHOOK_ARCHIVE_PURGE_INTERVAL_SECONDS: '3600',
    GAMEPLAY_EVENT_RETENTION_MONTHS: '13',
    GAMEPLAY_EVENT_PARTITION_MAINTENANCE_INTERVAL_SECONDS: '86400',
    RECONCILIATION_INTERVAL_SECONDS: '900',
    AI_CREDIT_RESERVATION_STALENESS_SECONDS: '1800',
    OPERATIONAL_ALERTS_EVALUATION_INTERVAL_SECONDS: '300',
    OPERATIONAL_ALERTS_COOLDOWN_SECONDS: '1800',
    OPERATIONAL_ALERTS_QUEUE_DEPTH_THRESHOLD: '200',
    OPERATIONAL_ALERTS_WEBHOOK_FAILURE_THRESHOLD: '10',
    OPERATIONAL_ALERTS_WEBHOOK_FAILURE_WINDOW_SECONDS: '3600',
    OPERATIONAL_ALERTS_STUCK_JOB_THRESHOLD: '1',
    OPERATIONAL_ALERTS_STUCK_JOB_STALENESS_SECONDS: '1800',
    OPERATIONAL_ALERTS_PROMOTION_NEEDS_ATTENTION_THRESHOLD: '1',
    SENTRY_ENVIRONMENT: 'test',
    SENTRY_RELEASE: 'stitch-wish-backend@test',
    SENTRY_TRACES_SAMPLE_RATE: '0',
    REVENUECAT_WEBHOOK_AUTH_TOKEN: 'integration-test-only-revenuecat-webhook-auth-token-at-least-32-chars',
    ADMOB_SSV_KEYS_URL: 'https://gstatic.com/admob/reward/verifier-keys.json',
    ADMOB_SSV_ALLOWED_AD_UNITS: '',
  };

  for (const [key, value] of Object.entries(defaultEnv)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }

  // Always delete optional keys that might steer factories to real/production services
  const keysToDelete = [
    'RESEND_API_KEY',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_HOSTNAME',
    'SENTRY_DSN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_SERVICE_ACCOUNT_BASE64',
    'FAL_KEY',
    'FAL_WEBHOOK_SECRET',
    'FAL_WEBHOOK_BASE_URL',
  ];

  for (const key of keysToDelete) {
    delete process.env[key];
  }
}
