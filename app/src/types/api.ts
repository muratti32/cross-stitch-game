export type HealthCheckState = 'up' | 'down';

export interface HealthStatusResponse {
  status: 'ok' | 'degraded';
  checks: {
    postgres: HealthCheckState;
    redis: HealthCheckState;
  };
}

export function isHealthStatusResponse(value: unknown): value is HealthStatusResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.status !== 'ok' && candidate.status !== 'degraded') {
    return false;
  }
  if (typeof candidate.checks !== 'object' || candidate.checks === null) {
    return false;
  }
  const checks = candidate.checks as Record<string, unknown>;
  const isCheckState = (v: unknown): v is HealthCheckState => v === 'up' || v === 'down';
  return isCheckState(checks.postgres) && isCheckState(checks.redis);
}
