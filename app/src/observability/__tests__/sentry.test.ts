jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: jest.fn((x) => x),
  setUser: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock('../../config', () => ({
  Config: {
    sentry: { dsn: 'https://test@sentry.example/1', environment: 'test' },
  },
  isSentryConfigured: () => true,
}));

jest.mock('../../identity/guestIdentity', () => ({
  useIdentityStore: {
    getState: () => ({ accountId: null, guestId: null }),
    subscribe: jest.fn(),
  },
}));

type BeforeSend = (event: Record<string, unknown>) => Record<string, unknown> | null;

describe('sentry beforeSend - offline filtering (#152 / #153)', () => {
  let Sentry: { init: jest.Mock; addBreadcrumb: jest.Mock };
  let beforeSend: BeforeSend;

  beforeEach(() => {
    jest.resetModules();
    Sentry = require('@sentry/react-native');
    const { initSentry } = require('../sentry');
    initSentry();
    beforeSend = Sentry.init.mock.calls[0][0].beforeSend;
  });

  test('drops the #152 / STITCH-WISH-P offline event and records a breadcrumb instead', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Error performing request because the internet connection appears to be offline.',
          },
        ],
      },
    };

    expect(beforeSend(event)).toBeNull();
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'network' }),
    );
  });

  test('drops the #153 / STITCH-WISH-N offline event', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'Error',
            value: 'A network error has occurred. The Internet connection appears to be offline.',
          },
        ],
      },
    };

    expect(beforeSend(event)).toBeNull();
  });

  test('keeps a genuine backend failure event and still applies ADR-0035 PII scrubbing', () => {
    const event = {
      exception: { values: [{ type: 'Error', value: 'Session error: status 500' }] },
      extra: { email: 'player@example.com', taskCount: 3 },
      request: { headers: { Authorization: 'Bearer secret' } },
    };

    const result = beforeSend(event);
    expect(result).not.toBeNull();
    expect(result?.request).toBeUndefined();
    expect((result?.extra as Record<string, unknown>).email).toBe('[Scrubbed]');
    expect((result?.extra as Record<string, unknown>).taskCount).toBe(3);
  });

  test('records navigation memory breadcrumbs with resident metrics', async () => {
    const { addScreenMemoryBreadcrumb } = require('../sentry');
    await addScreenMemoryBreadcrumb('catalog_browse');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'navigation.memory',
        data: expect.objectContaining({
          screen: 'catalog_browse',
          residentBytes: expect.any(Number),
          jsHeapBytes: expect.any(Number),
        }),
      }),
    );
    const breadcrumb = Sentry.addBreadcrumb.mock.calls.at(-1)?.[0] as {
      message: string;
      data: { screen: string };
    };
    expect(breadcrumb.message).not.toMatch(/pattern_detail_|session_ready_/);
    expect(breadcrumb.data.screen).toBe('catalog_browse');
  });
});

describe('sentry init - app hang tracking (#149 / #150)', () => {
  let Sentry: { init: jest.Mock };
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  beforeEach(() => {
    jest.resetModules();
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    Sentry = require('@sentry/react-native');
  });

  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  function initAndGetOptions(): Record<string, unknown> {
    const { initSentry } = require('../sentry') as { initSentry: () => void };
    initSentry();
    return Sentry.init.mock.calls[0][0] as Record<string, unknown>;
  }

  test('disables enableAppHangTracking for development JS builds', () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;

    const options = initAndGetOptions();

    expect(options.enableAppHangTracking).toBe(false);
  });

  test.each(['staging', 'production'])(
    'enables enableAppHangTracking for %s physical-device builds',
    (environment) => {
      jest.doMock('../../config', () => ({
        Config: {
          sentry: { dsn: 'https://test@sentry.example/1', environment },
        },
        isSentryConfigured: () => true,
      }));

      const options = initAndGetOptions();

      expect(options.enableAppHangTracking).toBe(true);
    },
  );
});
