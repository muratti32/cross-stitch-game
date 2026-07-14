export type EnvironmentVariables = {
  DATABASE_URL: string;
  JWT_ACCESS_TTL_SECONDS: number;
  JWT_SECRET: string | undefined;
  PORT: number;
  REDIS_URL: string;
  REFRESH_TOKEN_TTL_SECONDS: number;
  STORAGE_LOCAL_DIR: string;
  GRANT_TTL_SECONDS: number;
  GRANT_SIGNING_SECRET: string | undefined;
  RESEND_API_KEY: string | undefined;
  OTP_SIGNING_SECRET: string | undefined;
  EMAIL_FROM_ADDRESS: string;
  EMAIL_OTP_TTL_SECONDS: number;
  EMAIL_OTP_MAX_ATTEMPTS: number;
  EMAIL_OTP_RATE_LIMIT_PER_EMAIL: number;
  EMAIL_OTP_RATE_LIMIT_PER_IP: number;
};

const DATABASE_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const DEFAULT_JWT_ACCESS_TTL_SECONDS = 900;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_GRANT_TTL_SECONDS = 300;
const DEFAULT_EMAIL_OTP_TTL_SECONDS = 600;
const DEFAULT_EMAIL_OTP_MAX_ATTEMPTS = 5;
const DEFAULT_EMAIL_OTP_RATE_LIMIT_PER_EMAIL = 5;
const DEFAULT_EMAIL_OTP_RATE_LIMIT_PER_IP = 20;
const REDIS_PROTOCOLS = new Set(['redis:', 'rediss:']);

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

export function parseEnvironment(
  environment: Record<string, unknown>,
): EnvironmentVariables {
  return {
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
