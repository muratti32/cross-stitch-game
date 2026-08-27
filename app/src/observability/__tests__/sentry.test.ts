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
});
