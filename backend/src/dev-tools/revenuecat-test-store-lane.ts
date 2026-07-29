const REVENUECAT_API_BASE_URL = 'https://api.revenuecat.com/v2';
const REVENUECAT_WEBHOOK_PATH = '/v1/commerce/revenuecat/webhook';

export interface RevenueCatTestStoreLaneConfig {
  backendBaseUrl: string;
  projectId: string;
  testStoreAppId: string;
  webhookIntegrationId: string;
  apiKey: string;
  webhookAuthorizationToken: string;
}

export interface TunnelInfo {
  publicUrl: string;
  localPort: number;
}

export interface RevenueCatTestStoreLaneDependencies {
  fetch: typeof fetch;
  ensureTunnel: () => Promise<TunnelInfo>;
  log: (message: string) => void;
}

interface RevenueCatApp {
  id?: unknown;
  project_id?: unknown;
  type?: unknown;
}

interface RevenueCatWebhookIntegration {
  id?: unknown;
  project_id?: unknown;
  environment?: unknown;
  app_id?: unknown;
  url?: unknown;
}

export function loadRevenueCatTestStoreLaneConfig(
  environment: NodeJS.ProcessEnv,
): RevenueCatTestStoreLaneConfig {
  const config = {
    backendBaseUrl: environment.REVENUECAT_LOCAL_BACKEND_URL ?? 'http://127.0.0.1:3000',
    projectId: required(environment, 'REVENUECAT_PROJECT_ID'),
    testStoreAppId: required(environment, 'REVENUECAT_TEST_STORE_APP_ID'),
    webhookIntegrationId: required(
      environment,
      'REVENUECAT_TEST_STORE_WEBHOOK_INTEGRATION_ID',
    ),
    apiKey: required(environment, 'REVENUECAT_API_V2_KEY'),
    webhookAuthorizationToken: required(environment, 'REVENUECAT_WEBHOOK_AUTH_TOKEN'),
  };

  assertLocalBackendUrl(config.backendBaseUrl);
  return config;
}

export async function runRevenueCatTestStoreLane(
  config: RevenueCatTestStoreLaneConfig,
  dependencies: RevenueCatTestStoreLaneDependencies,
): Promise<string> {
  const healthUrl = new URL('/v1/health', config.backendBaseUrl).toString();
  dependencies.log(`Checking local Game Backend health at ${healthUrl}`);
  const health = await requestJson(dependencies.fetch, healthUrl, {
    action: 'Local Game Backend health check',
  });
  assertHealthyBackend(health);

  const tunnel = await dependencies.ensureTunnel();
  if (tunnel.localPort !== 3000) {
    throw new Error(
      `Refusing ngrok tunnel for local port ${tunnel.localPort}; issue #78 requires port 3000.`,
    );
  }
  const webhookUrl = buildWebhookUrl(tunnel.publicUrl);

  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  const projectPath = encodeURIComponent(config.projectId);
  const appPath = encodeURIComponent(config.testStoreAppId);
  const integrationPath = encodeURIComponent(config.webhookIntegrationId);

  const app = (await requestJson(
    dependencies.fetch,
    `${REVENUECAT_API_BASE_URL}/projects/${projectPath}/apps/${appPath}`,
    { action: 'RevenueCat Test Store app validation', headers },
  )) as RevenueCatApp;
  assertTestStoreApp(app, config);

  const integrationUrl =
    `${REVENUECAT_API_BASE_URL}/projects/${projectPath}` +
    `/integrations/webhooks/${integrationPath}`;
  const integration = (await requestJson(dependencies.fetch, integrationUrl, {
    action: 'RevenueCat sandbox webhook validation',
    headers,
  })) as RevenueCatWebhookIntegration;
  assertSandboxIntegration(integration, config);

  const updated = (await requestJson(dependencies.fetch, integrationUrl, {
    action: 'RevenueCat sandbox webhook update',
    headers,
    method: 'POST',
    body: JSON.stringify({
      url: webhookUrl,
      authorization_header: config.webhookAuthorizationToken,
      environment: 'sandbox',
      app_id: config.testStoreAppId,
    }),
  })) as RevenueCatWebhookIntegration;
  assertSandboxIntegration(updated, config);
  if (updated.url !== webhookUrl) {
    throw new Error('RevenueCat API did not return the requested sandbox webhook URL.');
  }

  dependencies.log(`RevenueCat Test Store webhook: ${webhookUrl}`);
  return webhookUrl;
}

export function buildWebhookUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  if (url.protocol !== 'https:') {
    throw new Error(`ngrok tunnel must expose HTTPS; received ${url.protocol}`);
  }
  url.pathname = REVENUECAT_WEBHOOK_PATH;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Add it to backend/.env or your local shell environment.`);
  }
  return value;
}

function assertLocalBackendUrl(value: string): void {
  const url = new URL(value);
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  const port = url.port || (url.protocol === 'http:' ? '80' : '443');
  if (url.protocol !== 'http:' || !localHosts.has(url.hostname) || port !== '3000') {
    throw new Error(
      'REVENUECAT_LOCAL_BACKEND_URL must be an HTTP localhost URL on port 3000.',
    );
  }
}

function assertHealthyBackend(value: unknown): void {
  if (value === null || typeof value !== 'object') {
    throw new Error('Local Game Backend health response was not a JSON object.');
  }
  const health = value as Record<string, unknown>;
  const checks = health.checks;
  if (
    health.status !== 'ok' ||
    checks === null ||
    typeof checks !== 'object' ||
    (checks as Record<string, unknown>).postgres !== 'up' ||
    (checks as Record<string, unknown>).redis !== 'up'
  ) {
    throw new Error('Local Game Backend is degraded; PostgreSQL and Redis must both be up.');
  }
}

function assertTestStoreApp(
  app: RevenueCatApp,
  config: RevenueCatTestStoreLaneConfig,
): void {
  if (
    app.id !== config.testStoreAppId ||
    app.project_id !== config.projectId ||
    app.type !== 'rc_billing'
  ) {
    throw new Error(
      'Refusing webhook update: configured app is not the expected RevenueCat Test Store (rc_billing).',
    );
  }
}

function assertSandboxIntegration(
  integration: RevenueCatWebhookIntegration,
  config: RevenueCatTestStoreLaneConfig,
): void {
  if (
    integration.id !== config.webhookIntegrationId ||
    integration.project_id !== config.projectId ||
    integration.environment !== 'sandbox' ||
    integration.app_id !== config.testStoreAppId
  ) {
    throw new Error(
      'Refusing webhook update: integration must already be sandbox-only and scoped to the configured Test Store app.',
    );
  }
}

async function requestJson(
  fetchImplementation: typeof fetch,
  url: string,
  options: RequestInit & { action: string },
): Promise<unknown> {
  const { action, ...request } = options;
  let response: Response;
  try {
    response = await fetchImplementation(url, request);
  } catch (error: unknown) {
    throw new Error(`${action} could not connect: ${errorMessage(error)}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${action} failed with HTTP ${response.status}: ${safeResponseText(text)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${action} returned invalid JSON.`);
  }
}

function safeResponseText(value: string): string {
  if (!value) return 'empty response';
  return value.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
