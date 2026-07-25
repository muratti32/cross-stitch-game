import { config as loadEnvironmentFile } from 'dotenv';

export type EnvironmentVariables = {
  CONVERSION_ENGINE_URL: string;
  CONVERSION_WORKER_CONCURRENCY: number;
  DATABASE_URL: string;
  JWT_ACCESS_TTL_SECONDS: number;
  JWT_SECRET: string | undefined;
  PORT: number;
  REDIS_URL: string;
  REFRESH_TOKEN_TTL_SECONDS: number;
  STORAGE_LOCAL_DIR: string;
  R2_ACCOUNT_ID: string | undefined;
  R2_ACCESS_KEY_ID: string | undefined;
  R2_SECRET_ACCESS_KEY: string | undefined;
  R2_BUCKET_NAME: string | undefined;
  R2_PUBLIC_HOSTNAME: string | undefined;
  GRANT_TTL_SECONDS: number;
  GRANT_SIGNING_SECRET: string | undefined;
  RESEND_API_KEY: string | undefined;
  OTP_SIGNING_SECRET: string | undefined;
  EMAIL_FROM_ADDRESS: string;
  EMAIL_OTP_TTL_SECONDS: number;
  EMAIL_OTP_MAX_ATTEMPTS: number;
  EMAIL_OTP_RATE_LIMIT_PER_EMAIL: number;
  EMAIL_OTP_RATE_LIMIT_PER_IP: number;
  FIREBASE_PROJECT_ID: string | undefined;
  FIREBASE_SERVICE_ACCOUNT_BASE64: string | undefined;
  ADMIN_JWT_SECRET: string | undefined;
  ADMIN_JWT_ACCESS_TTL_SECONDS: number;
  ADMIN_MFA_ENABLED: boolean;
  ADMIN_REFRESH_TOKEN_TTL_SECONDS: number;
  ADMIN_TOTP_ENC_KEY: string | undefined;
  ADMIN_TOTP_ISSUER: string;
  ADMOB_SSV_KEYS_URL: string;
  ADMOB_SSV_ALLOWED_AD_UNITS: readonly string[];
  REVENUECAT_WEBHOOK_AUTH_TOKEN: string | undefined;
  AD_ATTEMPT_TTL_SECONDS: number;
  FAL_WEBHOOK_SECRET: string | undefined;
  FAL_KEY: string | undefined;
  FAL_WEBHOOK_BASE_URL: string | undefined;
  WEBHOOK_ARCHIVE_RETENTION_SECONDS: number;
  WEBHOOK_ARCHIVE_PURGE_INTERVAL_SECONDS: number;
  OPENAI_MODERATION_ENABLED: boolean;
  SENTRY_DSN: string | undefined;
  SENTRY_ENVIRONMENT: string;
  SENTRY_RELEASE: string | undefined;
  SENTRY_TRACES_SAMPLE_RATE: number;
};

export type SentryEnvironmentVariables = Pick<
  EnvironmentVariables,
  | 'SENTRY_DSN'
  | 'SENTRY_ENVIRONMENT'
  | 'SENTRY_RELEASE'
  | 'SENTRY_TRACES_SAMPLE_RATE'
>;

const DATABASE_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const DEFAULT_JWT_ACCESS_TTL_SECONDS = 900;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_GRANT_TTL_SECONDS = 300;
const DEFAULT_EMAIL_OTP_TTL_SECONDS = 600;
const DEFAULT_EMAIL_OTP_MAX_ATTEMPTS = 5;
const DEFAULT_EMAIL_OTP_RATE_LIMIT_PER_EMAIL = 5;
const DEFAULT_EMAIL_OTP_RATE_LIMIT_PER_IP = 20;
const REDIS_PROTOCOLS = new Set(['redis:', 'rediss:']);
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const DEFAULT_ADMIN_JWT_ACCESS_TTL_SECONDS = 900;
const DEFAULT_ADMIN_REFRESH_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const DEFAULT_ADMIN_TOTP_ISSUER = 'Stitch Wish Operator Console';
const ADMIN_TOTP_ENC_KEY_BYTES = 32;
const DEFAULT_ADMOB_SSV_KEYS_URL =
  'https://gstatic.com/admob/reward/verifier-keys.json';
const DEFAULT_AD_ATTEMPT_TTL_SECONDS = 300;
const DEFAULT_WEBHOOK_ARCHIVE_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_WEBHOOK_ARCHIVE_PURGE_INTERVAL_SECONDS = 60 * 60;

function parseHexKey(
  value: unknown,
  variableName: string,
  byteLength: number,
): string | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (
    typeof value !== 'string' ||
    value.length !== byteLength * 2 ||
    !/^[0-9a-fA-F]+$/.test(value)
  ) {
    throw new Error(
      `${variableName} must be a ${byteLength * 2}-character hex string (${byteLength} bytes)`,
    );
  }
  return value.toLowerCase();
}

function parseUrl(
  value: unknown,
  variableName: string,
  allowedProtocols: ReadonlySet<string>,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${variableName} is required`);
  }

  const normalizedValue = value.trim();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalizedValue);
  } catch {
    throw new Error(`${variableName} must be a valid URL`);
  }

  if (!allowedProtocols.has(parsedUrl.protocol)) {
    throw new Error(`${variableName} uses an unsupported protocol`);
  }

  if (parsedUrl.hostname.length === 0) {
    throw new Error(`${variableName} must include a hostname`);
  }

  return normalizedValue;
}

function parsePort(value: unknown): number {
  if (
    (typeof value !== 'string' || value.trim().length === 0) &&
    typeof value !== 'number'
  ) {
    throw new Error('PORT is required');
  }

  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const port = typeof value === 'number' ? value : Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return port;
}

function parseOptionalSecret(
  value: unknown,
  variableName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.length < 32) {
    throw new Error(`${variableName} must be at least 32 characters`);
  }

  return value;
}

function parseDurationSeconds(
  value: unknown,
  variableName: string,
  defaultValue: number,
): number {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'string' && !/^\d+$/.test(value.trim()))
  ) {
    throw new Error(`${variableName} must be a positive integer`);
  }

  const duration = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(duration) || duration < 1) {
    throw new Error(`${variableName} must be a positive integer`);
  }

  return duration;
}

function parseRequiredString(value: unknown, variableName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${variableName} is required`);
  }
  return value.trim();
}

function parseBoolean(
  value: unknown,
  variableName: string,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  throw new Error(`${variableName} must be either true or false`);
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function parseCommaList(value: unknown): readonly string[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseSampleRate(
  value: unknown,
  variableName: string,
  defaultValue: number,
): number {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    throw new Error(`${variableName} must be a number between 0 and 1`);
  }

  const sampleRate = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    throw new Error(`${variableName} must be a number between 0 and 1`);
  }
  return sampleRate;
}

function parseOptionalSentryDsn(value: unknown): string | undefined {
  const dsn = parseOptionalString(value);
  if (dsn === undefined) {
    return undefined;
  }

  try {
    const parsedDsn = new URL(dsn);
    if (
      !HTTP_PROTOCOLS.has(parsedDsn.protocol) ||
      parsedDsn.hostname.length === 0 ||
      parsedDsn.username.length === 0
    ) {
      throw new Error();
    }
  } catch {
    throw new Error('SENTRY_DSN must be a valid Sentry DSN URL');
  }

  return dsn;
}

/**
 * Reads the Sentry subset needed before Nest creates an application. This
 * remains in the configuration layer because Sentry instrumentation must run
 * before the ConfigModule and application modules are imported.
 */
export function parseSentryEnvironment(
  environment: Record<string, unknown>,
): SentryEnvironmentVariables {
  const dsn = parseOptionalSentryDsn(environment.SENTRY_DSN);
  const environmentName =
    parseOptionalString(environment.SENTRY_ENVIRONMENT) ??
    parseOptionalString(environment.NODE_ENV) ??
    'development';
  const release = parseOptionalString(environment.SENTRY_RELEASE);
  if (dsn !== undefined && release === undefined) {
    throw new Error('SENTRY_RELEASE is required when SENTRY_DSN is configured');
  }

  return {
    SENTRY_DSN: dsn,
    SENTRY_ENVIRONMENT: environmentName,
    SENTRY_RELEASE: release,
    SENTRY_TRACES_SAMPLE_RATE: parseSampleRate(
      environment.SENTRY_TRACES_SAMPLE_RATE,
      'SENTRY_TRACES_SAMPLE_RATE',
      environmentName === 'production' ? 0.2 : 1,
    ),
  };
}

export function readSentryBootstrapEnvironment(): SentryEnvironmentVariables {
  // ConfigModule loads this same default file later in application bootstrap.
  // Sentry must initialize first, so load it here within the configuration
  // layer before the Nest application and ConfigModule exist.
  loadEnvironmentFile();
  return parseSentryEnvironment(process.env);
}

// R2 credentials are all-or-nothing: a partially configured R2 setup would
// otherwise fail silently by falling back to LocalObjectStorage, masking a
// deployment misconfiguration. R2_PUBLIC_HOSTNAME stays independent since
// R2ObjectStorage falls back to the backend proxy path when it's absent.
function parseR2Config(environment: Record<string, unknown>): {
  R2_ACCOUNT_ID: string | undefined;
  R2_ACCESS_KEY_ID: string | undefined;
  R2_SECRET_ACCESS_KEY: string | undefined;
  R2_BUCKET_NAME: string | undefined;
  R2_PUBLIC_HOSTNAME: string | undefined;
} {
  const accountId = parseOptionalString(environment.R2_ACCOUNT_ID);
  const accessKeyId = parseOptionalString(environment.R2_ACCESS_KEY_ID);
  const secretAccessKey = parseOptionalString(environment.R2_SECRET_ACCESS_KEY);
  const bucketName = parseOptionalString(environment.R2_BUCKET_NAME);
  const publicHostname = parseOptionalString(environment.R2_PUBLIC_HOSTNAME);

  const provided = [accountId, accessKeyId, secretAccessKey, bucketName];
  const anyProvided = provided.some((value) => value !== undefined);
  const allProvided = provided.every((value) => value !== undefined);

  if (anyProvided && !allProvided) {
    throw new Error(
      'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME must all be set together to enable R2 object storage',
    );
  }

  return {
    R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET_NAME: bucketName,
    R2_PUBLIC_HOSTNAME: publicHostname,
  };
}

function parseAdminMfaEnabled(environment: Record<string, unknown>): boolean {
  const enabled = parseBoolean(
    environment.ADMIN_MFA_ENABLED,
    'ADMIN_MFA_ENABLED',
    true,
  );
  if (!enabled && environment.NODE_ENV === 'production') {
    throw new Error('ADMIN_MFA_ENABLED cannot be false in production');
  }
  return enabled;
}

function parseOpenAiModerationEnabled(
  environment: Record<string, unknown>,
): boolean {
  const enabled = parseBoolean(
    environment.OPENAI_MODERATION_ENABLED,
    'OPENAI_MODERATION_ENABLED',
    true,
  );
  if (!enabled && environment.NODE_ENV === 'production') {
    throw new Error(
      'OPENAI_MODERATION_ENABLED cannot be false in production',
    );
  }
  return enabled;
}

export function parseEnvironment(
  environment: Record<string, unknown>,
): EnvironmentVariables {
  return {
    CONVERSION_ENGINE_URL:
      environment.CONVERSION_ENGINE_URL === undefined ||
      environment.CONVERSION_ENGINE_URL === ''
        ? 'http://127.0.0.1:8000'
        : parseUrl(
            environment.CONVERSION_ENGINE_URL,
            'CONVERSION_ENGINE_URL',
            HTTP_PROTOCOLS,
          ),
    CONVERSION_WORKER_CONCURRENCY: parseDurationSeconds(
      environment.CONVERSION_WORKER_CONCURRENCY,
      'CONVERSION_WORKER_CONCURRENCY',
      2,
    ),
    DATABASE_URL: parseUrl(
      environment.DATABASE_URL,
      'DATABASE_URL',
      DATABASE_PROTOCOLS,
    ),
    JWT_ACCESS_TTL_SECONDS: parseDurationSeconds(
      environment.JWT_ACCESS_TTL_SECONDS,
      'JWT_ACCESS_TTL_SECONDS',
      DEFAULT_JWT_ACCESS_TTL_SECONDS,
    ),
    JWT_SECRET: parseOptionalSecret(environment.JWT_SECRET, 'JWT_SECRET'),
    PORT: parsePort(environment.PORT),
    REDIS_URL: parseUrl(environment.REDIS_URL, 'REDIS_URL', REDIS_PROTOCOLS),
    REFRESH_TOKEN_TTL_SECONDS: parseDurationSeconds(
      environment.REFRESH_TOKEN_TTL_SECONDS,
      'REFRESH_TOKEN_TTL_SECONDS',
      DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
    ),
    STORAGE_LOCAL_DIR:
      typeof environment.STORAGE_LOCAL_DIR === 'string' &&
      environment.STORAGE_LOCAL_DIR.trim().length > 0
        ? environment.STORAGE_LOCAL_DIR.trim()
        : './storage-dev',
    ...parseR2Config(environment),
    GRANT_TTL_SECONDS: parseDurationSeconds(
      environment.GRANT_TTL_SECONDS,
      'GRANT_TTL_SECONDS',
      DEFAULT_GRANT_TTL_SECONDS,
    ),
    GRANT_SIGNING_SECRET: parseOptionalSecret(
      environment.GRANT_SIGNING_SECRET,
      'GRANT_SIGNING_SECRET',
    ),
    RESEND_API_KEY: parseOptionalSecret(
      environment.RESEND_API_KEY,
      'RESEND_API_KEY',
    ),
    OTP_SIGNING_SECRET: parseOptionalSecret(
      environment.OTP_SIGNING_SECRET,
      'OTP_SIGNING_SECRET',
    ),
    EMAIL_FROM_ADDRESS: parseRequiredString(
      environment.EMAIL_FROM_ADDRESS,
      'EMAIL_FROM_ADDRESS',
    ),
    EMAIL_OTP_TTL_SECONDS: parseDurationSeconds(
      environment.EMAIL_OTP_TTL_SECONDS,
      'EMAIL_OTP_TTL_SECONDS',
      DEFAULT_EMAIL_OTP_TTL_SECONDS,
    ),
    EMAIL_OTP_MAX_ATTEMPTS: parseDurationSeconds(
      environment.EMAIL_OTP_MAX_ATTEMPTS,
      'EMAIL_OTP_MAX_ATTEMPTS',
      DEFAULT_EMAIL_OTP_MAX_ATTEMPTS,
    ),
    EMAIL_OTP_RATE_LIMIT_PER_EMAIL: parseDurationSeconds(
      environment.EMAIL_OTP_RATE_LIMIT_PER_EMAIL,
      'EMAIL_OTP_RATE_LIMIT_PER_EMAIL',
      DEFAULT_EMAIL_OTP_RATE_LIMIT_PER_EMAIL,
    ),
    EMAIL_OTP_RATE_LIMIT_PER_IP: parseDurationSeconds(
      environment.EMAIL_OTP_RATE_LIMIT_PER_IP,
      'EMAIL_OTP_RATE_LIMIT_PER_IP',
      DEFAULT_EMAIL_OTP_RATE_LIMIT_PER_IP,
    ),
    FIREBASE_PROJECT_ID:
      environment.FIREBASE_PROJECT_ID === undefined ||
      environment.FIREBASE_PROJECT_ID === ''
        ? undefined
        : parseRequiredString(
            environment.FIREBASE_PROJECT_ID,
            'FIREBASE_PROJECT_ID',
          ),
    FIREBASE_SERVICE_ACCOUNT_BASE64: parseOptionalSecret(
      environment.FIREBASE_SERVICE_ACCOUNT_BASE64,
      'FIREBASE_SERVICE_ACCOUNT_BASE64',
    ),
    ADMIN_JWT_SECRET: parseOptionalSecret(
      environment.ADMIN_JWT_SECRET,
      'ADMIN_JWT_SECRET',
    ),
    ADMIN_JWT_ACCESS_TTL_SECONDS: parseDurationSeconds(
      environment.ADMIN_JWT_ACCESS_TTL_SECONDS,
      'ADMIN_JWT_ACCESS_TTL_SECONDS',
      DEFAULT_ADMIN_JWT_ACCESS_TTL_SECONDS,
    ),
    ADMIN_MFA_ENABLED: parseAdminMfaEnabled(environment),
    ADMIN_REFRESH_TOKEN_TTL_SECONDS: parseDurationSeconds(
      environment.ADMIN_REFRESH_TOKEN_TTL_SECONDS,
      'ADMIN_REFRESH_TOKEN_TTL_SECONDS',
      DEFAULT_ADMIN_REFRESH_TOKEN_TTL_SECONDS,
    ),
    ADMIN_TOTP_ENC_KEY: parseHexKey(
      environment.ADMIN_TOTP_ENC_KEY,
      'ADMIN_TOTP_ENC_KEY',
      ADMIN_TOTP_ENC_KEY_BYTES,
    ),
    ADMIN_TOTP_ISSUER:
      typeof environment.ADMIN_TOTP_ISSUER === 'string' &&
      environment.ADMIN_TOTP_ISSUER.trim().length > 0
        ? environment.ADMIN_TOTP_ISSUER.trim()
        : DEFAULT_ADMIN_TOTP_ISSUER,
    ADMOB_SSV_KEYS_URL:
      environment.ADMOB_SSV_KEYS_URL === undefined ||
      environment.ADMOB_SSV_KEYS_URL === ''
        ? DEFAULT_ADMOB_SSV_KEYS_URL
        : parseUrl(
            environment.ADMOB_SSV_KEYS_URL,
            'ADMOB_SSV_KEYS_URL',
            HTTP_PROTOCOLS,
          ),
    ADMOB_SSV_ALLOWED_AD_UNITS: parseCommaList(
      environment.ADMOB_SSV_ALLOWED_AD_UNITS,
    ),
    REVENUECAT_WEBHOOK_AUTH_TOKEN: parseOptionalSecret(
      environment.REVENUECAT_WEBHOOK_AUTH_TOKEN,
      'REVENUECAT_WEBHOOK_AUTH_TOKEN',
    ),
    AD_ATTEMPT_TTL_SECONDS: parseDurationSeconds(
      environment.AD_ATTEMPT_TTL_SECONDS,
      'AD_ATTEMPT_TTL_SECONDS',
      DEFAULT_AD_ATTEMPT_TTL_SECONDS,
    ),
    FAL_WEBHOOK_SECRET: parseOptionalSecret(
      environment.FAL_WEBHOOK_SECRET,
      'FAL_WEBHOOK_SECRET',
    ),
    FAL_KEY: parseOptionalSecret(environment.FAL_KEY, 'FAL_KEY'),
    FAL_WEBHOOK_BASE_URL:
      environment.FAL_WEBHOOK_BASE_URL === undefined ||
      environment.FAL_WEBHOOK_BASE_URL === ''
        ? undefined
        : parseUrl(
            environment.FAL_WEBHOOK_BASE_URL,
            'FAL_WEBHOOK_BASE_URL',
            HTTP_PROTOCOLS,
          ),
    WEBHOOK_ARCHIVE_RETENTION_SECONDS: parseDurationSeconds(
      environment.WEBHOOK_ARCHIVE_RETENTION_SECONDS,
      'WEBHOOK_ARCHIVE_RETENTION_SECONDS',
      DEFAULT_WEBHOOK_ARCHIVE_RETENTION_SECONDS,
    ),
    WEBHOOK_ARCHIVE_PURGE_INTERVAL_SECONDS: parseDurationSeconds(
      environment.WEBHOOK_ARCHIVE_PURGE_INTERVAL_SECONDS,
      'WEBHOOK_ARCHIVE_PURGE_INTERVAL_SECONDS',
      DEFAULT_WEBHOOK_ARCHIVE_PURGE_INTERVAL_SECONDS,
    ),
    OPENAI_MODERATION_ENABLED: parseOpenAiModerationEnabled(environment),
    ...parseSentryEnvironment(environment),
  };
}


export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...environment,
    ...parseEnvironment(environment),
  };
}
