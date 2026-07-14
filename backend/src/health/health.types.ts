export type DependencyStatus = 'down' | 'up';

export type HealthResponse = {
  checks: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
  };
  status: 'degraded' | 'ok';
};
