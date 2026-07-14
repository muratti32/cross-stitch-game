export type EnvironmentVariables = {
  DATABASE_URL: string;
  PORT: number;
  REDIS_URL: string;
};

const DATABASE_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
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

export function parseEnvironment(
  environment: Record<string, unknown>,
): EnvironmentVariables {
  return {
    DATABASE_URL: parseUrl(
      environment.DATABASE_URL,
      'DATABASE_URL',
      DATABASE_PROTOCOLS,
    ),
    PORT: parsePort(environment.PORT),
    REDIS_URL: parseUrl(environment.REDIS_URL, 'REDIS_URL', REDIS_PROTOCOLS),
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
