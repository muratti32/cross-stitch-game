import {
  buildWebhookUrl,
  loadRevenueCatTestStoreLaneConfig,
  runRevenueCatTestStoreLane,
  type RevenueCatTestStoreLaneConfig,
} from './revenuecat-test-store-lane';

const CONFIG: RevenueCatTestStoreLaneConfig = {
  backendBaseUrl: 'http://127.0.0.1:3000',
  projectId: 'project-test',
  testStoreAppId: 'app-test-store',
  webhookIntegrationId: 'webhook-sandbox',
  apiKey: 'secret-api-key',
  webhookAuthorizationToken: 'secret-webhook-token',
};

describe('RevenueCat Test Store local lane', () => {
  it('requires every RevenueCat credential and identifier', () => {
    expect(() => loadRevenueCatTestStoreLaneConfig({})).toThrow(
      'Missing REVENUECAT_PROJECT_ID',
    );
  });

  it('accepts only a local HTTP backend on port 3000', () => {
    expect(() =>
      loadRevenueCatTestStoreLaneConfig({
        REVENUECAT_PROJECT_ID: 'project-test',
        REVENUECAT_TEST_STORE_APP_ID: 'app-test-store',
        REVENUECAT_TEST_STORE_WEBHOOK_INTEGRATION_ID: 'webhook-sandbox',
        REVENUECAT_API_V2_KEY: 'secret-api-key',
        REVENUECAT_WEBHOOK_AUTH_TOKEN: 'secret-webhook-token',
        REVENUECAT_LOCAL_BACKEND_URL: 'https://api.example.com',
      }),
    ).toThrow('must be an HTTP localhost URL on port 3000');
  });

  it('builds the exact backend webhook path under an HTTPS tunnel', () => {
    expect(buildWebhookUrl('https://example.ngrok.app/old?query=yes')).toBe(
      'https://example.ngrok.app/v1/commerce/revenuecat/webhook',
    );
    expect(() => buildWebhookUrl('http://example.ngrok.app')).toThrow(
      'must expose HTTPS',
    );
  });

  it('stops before RevenueCat calls when backend health is degraded', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      response({ status: 'degraded', checks: { postgres: 'down', redis: 'up' } }),
    );

    await expect(
      runRevenueCatTestStoreLane(CONFIG, {
        fetch: fetchMock,
        ensureTunnel: jest.fn(),
        log: jest.fn(),
      }),
    ).rejects.toThrow('Local Game Backend is degraded');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a production integration without issuing an update', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(response(testStoreApp()))
      .mockResolvedValueOnce(
        response({
          id: CONFIG.webhookIntegrationId,
          project_id: CONFIG.projectId,
          environment: 'production',
          app_id: CONFIG.testStoreAppId,
        }),
      );

    await expect(run(fetchMock)).rejects.toThrow('integration must be sandbox-only');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refuses an app that is not RevenueCat Test Store', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(response({ ...testStoreApp(), type: 'app_store' }));

    await expect(run(fetchMock)).rejects.toThrow('not the expected RevenueCat Test Store');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a sandbox integration scoped to another app', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(response(testStoreApp()))
      .mockResolvedValueOnce(
        response({
          id: CONFIG.webhookIntegrationId,
          project_id: CONFIG.projectId,
          environment: 'sandbox',
          app_id: 'another-app',
        }),
      );

    await expect(run(fetchMock)).rejects.toThrow('integration must be sandbox-only');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops when ngrok does not expose local port 3000', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(healthyResponse());

    await expect(
      runRevenueCatTestStoreLane(CONFIG, {
        fetch: fetchMock,
        ensureTunnel: () =>
          Promise.resolve({ publicUrl: 'https://example.ngrok.app', localPort: 4000 }),
        log: jest.fn(),
      }),
    ).rejects.toThrow('requires port 3000');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an actionable RevenueCat API error without attempting an update', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(response({ message: 'denied' }, 403));

    await expect(run(fetchMock)).rejects.toThrow(
      'RevenueCat Test Store app validation failed with HTTP 403',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('narrows a validated project-wide sandbox integration to Test Store and reports its URL', async () => {
    const webhookUrl = 'https://example.ngrok.app/v1/commerce/revenuecat/webhook';
    let updateRequest: RequestInit | undefined;
    const integration = {
      id: CONFIG.webhookIntegrationId,
      project_id: CONFIG.projectId,
      environment: 'sandbox',
      app_id: null,
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(response(testStoreApp()))
      .mockResolvedValueOnce(response(integration))
      .mockImplementationOnce((_url: string, request: RequestInit | undefined) => {
        updateRequest = request;
        return Promise.resolve(
          response({ ...integration, app_id: CONFIG.testStoreAppId, url: webhookUrl }),
        );
      });

    await expect(run(fetchMock)).resolves.toBe(webhookUrl);
    expect(updateRequest).toMatchObject({ method: 'POST' });
    const updateBody = updateRequest?.body;
    if (typeof updateBody !== 'string') throw new Error('Expected a JSON update body');
    expect(JSON.parse(updateBody) as unknown).toEqual({
      url: webhookUrl,
      authorization_header: CONFIG.webhookAuthorizationToken,
      environment: 'sandbox',
      app_id: CONFIG.testStoreAppId,
    });
  });
});

function run(fetchMock: jest.Mock): Promise<string> {
  return runRevenueCatTestStoreLane(CONFIG, {
    fetch: fetchMock,
    ensureTunnel: () =>
      Promise.resolve({
        publicUrl: 'https://example.ngrok.app',
        localPort: 3000,
      }),
    log: jest.fn(),
  });
}

function testStoreApp(): Record<string, unknown> {
  return {
    id: CONFIG.testStoreAppId,
    project_id: CONFIG.projectId,
    type: 'test_store',
  };
}

function healthyResponse(): Response {
  return response({ status: 'ok', checks: { postgres: 'up', redis: 'up' } });
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}
