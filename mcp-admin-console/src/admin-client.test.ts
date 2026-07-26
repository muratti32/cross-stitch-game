import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AdminClient,
  AdminApiError,
  MAX_INLINE_BINARY_BYTES,
} from './admin-client.js';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const originalFetch = globalThis.fetch;
const recordedCalls: RecordedCall[] = [];
const responseQueue: Response[] = [];

function setupFetchStub() {
  recordedCalls.length = 0;
  responseQueue.length = 0;

  const stub = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : 'href' in input ? input.href : String(input);
    const method = init?.method ?? 'GET';
    const headers: Record<string, string> = {};

    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          headers[key.toLowerCase()] = value;
        }
      } else {
        for (const [key, value] of Object.entries(init.headers)) {
          if (value !== undefined) {
            headers[key.toLowerCase()] = String(value);
          }
        }
      }
    }

    let body: unknown = undefined;
    if (init?.body) {
      if (typeof init.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      } else {
        body = init.body;
      }
    }

    recordedCalls.push({ url, method, headers, body });

    const response = responseQueue.shift();
    if (!response) {
      throw new Error(`No mocked response for ${method} ${url}`);
    }
    return response;
  };

  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function jsonResponse(payload: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

async function authenticate(client: AdminClient, calls?: RecordedCall[]) {
  responseQueue.push(
    jsonResponse({
      status: 'mfa_required',
      challenge: 'test-challenge',
      expiresAt: '2026-07-26T00:00:00Z',
    }),
  );
  responseQueue.push(
    jsonResponse({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      operator: { id: 'op123', email: 'test@example.com', role: 'admin' },
    }),
  );
  await client.login('admin@example.com', 'password');
  await client.verifyMfa({ totpCode: '123456' });
  if (calls) {
    calls.length = 0;
  }
}

describe('Request id injection', () => {
  beforeEach(() => {
    setupFetchStub();
  });

  afterEach(() => {
    restoreFetch();
  });

  test('Every authenticated request carries a valid UUID x-request-id header', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    responseQueue.push(jsonResponse({ success: true }));
    await client.request('GET', '/users');

    assert.equal(recordedCalls.length, 1);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.match(recordedCalls[0].headers['x-request-id'], uuidRegex);
  });

  test('Two consecutive requests carry different x-request-id values', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    responseQueue.push(jsonResponse({ success: true }));
    responseQueue.push(jsonResponse({ success: true }));

    await client.request('GET', '/users');
    await client.request('GET', '/roles');

    assert.equal(recordedCalls.length, 2);
    const id1 = recordedCalls[0].headers['x-request-id'];
    const id2 = recordedCalls[1].headers['x-request-id'];
    assert.ok(id1);
    assert.ok(id2);
    assert.notEqual(id1, id2);
  });

  test('requestBinary also sends an x-request-id', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    const bytes = new Uint8Array([1, 2, 3]);
    responseQueue.push(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );

    await client.requestBinary('GET', '/image.png');

    assert.equal(recordedCalls.length, 1);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.match(recordedCalls[0].headers['x-request-id'], uuidRegex);
  });
});

describe('Content-type branching', () => {
  beforeEach(() => {
    setupFetchStub();
  });

  afterEach(() => {
    restoreFetch();
  });

  test('A JSON response is parsed into an object', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    responseQueue.push(jsonResponse({ foo: 'bar' }));
    const result = await client.request('GET', '/json');

    assert.deepEqual(result, { foo: 'bar' });
  });

  test('A response with no content-type header is still parsed as JSON', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    const res = new Response(JSON.stringify({ baz: 'qux' }), { status: 200 });
    res.headers.delete('content-type');
    responseQueue.push(res);
    const result = await client.request('GET', '/no-content-type');

    assert.deepEqual(result, { baz: 'qux' });
  });

  test('A text/plain response is returned as the raw string, not parsed', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    responseQueue.push(
      new Response('raw text data', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const result = await client.request('GET', '/text');
    assert.equal(result, 'raw text data');
  });

  test('An empty body with a 200 returns null', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    responseQueue.push(new Response('', { status: 200 }));
    const result = await client.request('GET', '/empty');
    assert.equal(result, null);
  });

  test('A 400 JSON error response throws AdminApiError with status === 400 and parsed body', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    responseQueue.push(jsonResponse({ error: 'bad request' }, 400));

    await assert.rejects(
      async () => {
        await client.request('GET', '/error');
      },
      (err: unknown) => {
        return (
          err instanceof AdminApiError &&
          err.status === 400 &&
          JSON.stringify(err.body) === JSON.stringify({ error: 'bad request' })
        );
      },
    );
  });
});

describe('Refresh on 401', () => {
  beforeEach(() => {
    setupFetchStub();
  });

  afterEach(() => {
    restoreFetch();
  });

  test('A 401 followed by successful /auth/refresh retries original request with new token', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    responseQueue.push(jsonResponse({ error: 'Unauthorized' }, 401));
    responseQueue.push(
      jsonResponse({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      }),
    );
    responseQueue.push(jsonResponse({ data: 'success' }));

    const result = await client.request('GET', '/some-route');

    assert.deepEqual(result, { data: 'success' });
    assert.equal(recordedCalls.length, 3);

    assert.equal(recordedCalls[0].url, 'http://localhost/v1/admin/some-route');
    assert.equal(recordedCalls[0].headers.authorization, 'Bearer test-access-token');

    assert.equal(recordedCalls[1].url, 'http://localhost/v1/admin/auth/refresh');
    assert.equal(recordedCalls[1].method, 'POST');
    assert.deepEqual(recordedCalls[1].body, { refreshToken: 'test-refresh-token' });

    assert.equal(recordedCalls[2].url, 'http://localhost/v1/admin/some-route');
    assert.equal(recordedCalls[2].headers.authorization, 'Bearer new-access-token');
  });

  test('A 401 whose refresh fails surfaces AdminApiError and clears authentication', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    responseQueue.push(jsonResponse({ error: 'Unauthorized' }, 401));
    responseQueue.push(jsonResponse({ error: 'Invalid refresh token' }, 400));

    await assert.rejects(
      async () => {
        await client.request('GET', '/some-route');
      },
      (err: unknown) => {
        return err instanceof AdminApiError && err.status === 401;
      },
    );

    assert.equal(client.isAuthenticated(), false);
  });

  test('A retry happens at most once: 401 -> refresh ok -> 401 again does not loop and throws', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    responseQueue.push(jsonResponse({ error: 'Unauthorized' }, 401));
    responseQueue.push(
      jsonResponse({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      }),
    );
    responseQueue.push(jsonResponse({ error: 'Unauthorized retry' }, 401));

    await assert.rejects(
      async () => {
        await client.request('GET', '/some-route');
      },
      (err: unknown) => {
        return err instanceof AdminApiError && err.status === 401;
      },
    );

    assert.equal(recordedCalls.length, 3);
    assert.equal(recordedCalls[0].url, 'http://localhost/v1/admin/some-route');
    assert.equal(recordedCalls[1].url, 'http://localhost/v1/admin/auth/refresh');
    assert.equal(recordedCalls[2].url, 'http://localhost/v1/admin/some-route');
  });
});

describe('Binary + size cap', () => {
  beforeEach(() => {
    setupFetchStub();
  });

  afterEach(() => {
    restoreFetch();
  });

  test('A successful binary response returns expected structure and valid base64', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // 'Hello'
    responseQueue.push(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );

    const result = await client.requestBinary('GET', '/image.png');
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.byteLength, 5);

    const decoded = Buffer.from(result.base64, 'base64');
    assert.deepEqual(new Uint8Array(decoded), bytes);
  });

  test('A content-type with parameters strips them and yields the base mimeType', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    const bytes = new Uint8Array([0]);
    responseQueue.push(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'image/png; charset=binary' },
      }),
    );

    const result = await client.requestBinary('GET', '/image.png');
    assert.equal(result.mimeType, 'image/png');
  });

  test('A missing content-type yields application/octet-stream', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    const bytes = new Uint8Array([0]);
    responseQueue.push(new Response(bytes, { status: 200 }));

    const result = await client.requestBinary('GET', '/file');
    assert.equal(result.mimeType, 'application/octet-stream');
  });

  test('A body larger than MAX_INLINE_BINARY_BYTES throws a plain Error with limit info', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    const largeBytes = new Uint8Array(MAX_INLINE_BINARY_BYTES + 1);
    responseQueue.push(
      new Response(largeBytes, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );

    await assert.rejects(
      async () => {
        await client.requestBinary('GET', '/large-file');
      },
      (err: unknown) => {
        return (
          err instanceof Error &&
          !(err instanceof AdminApiError) &&
          err.message.includes(String(MAX_INLINE_BINARY_BYTES)) &&
          err.message.includes(String(MAX_INLINE_BINARY_BYTES + 1))
        );
      },
    );
  });

  test('A 404 on a binary route throws AdminApiError with status 404', async () => {
    const client = new AdminClient('http://localhost');
    await authenticate(client, recordedCalls);

    responseQueue.push(jsonResponse({ error: 'Not Found' }, 404));

    await assert.rejects(
      async () => {
        await client.requestBinary('GET', '/missing-file');
      },
      (err: unknown) => {
        return err instanceof AdminApiError && err.status === 404;
      },
    );
  });
});

describe('Auth guards', () => {
  beforeEach(() => {
    setupFetchStub();
  });

  afterEach(() => {
    restoreFetch();
  });

  test('request on a fresh unauthenticated client rejects with auth message', async () => {
    const client = new AdminClient('http://localhost');

    await assert.rejects(
      async () => {
        await client.request('GET', '/users');
      },
      (err: unknown) => {
        return (
          err instanceof Error &&
          err.message === 'Not authenticated. Call admin_login then admin_verify_mfa first.'
        );
      },
    );
  });

  test('requestBinary on a fresh unauthenticated client rejects with auth message', async () => {
    const client = new AdminClient('http://localhost');

    await assert.rejects(
      async () => {
        await client.requestBinary('GET', '/image.png');
      },
      (err: unknown) => {
        return (
          err instanceof Error &&
          err.message === 'Not authenticated. Call admin_login then admin_verify_mfa first.'
        );
      },
    );
  });
});
