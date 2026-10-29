// captureEvent returns a distinct id per call (not a constant) so tests
// that assert "the same Support Reference" or "a new capture" are only
// meaningful because of the production dedup logic, not because the mock
// happens to always return the same value.
let mockEventIdCounter = 0;

jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureEvent: jest.fn(() => {
    mockEventIdCounter += 1;
    return mockEventIdCounter.toString(16).padStart(32, '0');
  }),
  captureMessage: jest.fn(),
}));

import * as Sentry from '@sentry/react-native';
import i18n from '../../i18n/i18n';
import { isServerApiError, localizeServerError } from '../localizeServerError';

/** The Support Reference string produced from the Nth (1-indexed) captureEvent call this test. */
function supportReferenceLine(callIndex: number): string {
  const mock = Sentry.captureEvent as jest.Mock;
  const eventId = mock.mock.results[callIndex - 1].value as string;
  return `Support Reference: SW-${eventId.toUpperCase()}`;
}

/** The event sent by the Nth (1-indexed) captureEvent call this test. */
function capturedEvent(callIndex = 1): Sentry.Event {
  return (Sentry.captureEvent as jest.Mock).mock.calls[callIndex - 1][0] as Sentry.Event;
}

class FakeServerApiError extends Error {
  constructor(readonly status: number, message: string, readonly reason: string | null) {
    super(message);
    this.name = 'FakeServerApiError';
  }
}

describe('isServerApiError', () => {
  it('recognizes any error shaped like this app backend API error classes', () => {
    expect(isServerApiError(new FakeServerApiError(403, 'nope', 'provider_rejected'))).toBe(true);
  });

  it('rejects a plain Error with no status/reason', () => {
    expect(isServerApiError(new Error('Network request failed'))).toBe(false);
  });

  it('rejects a non-Error value', () => {
    expect(isServerApiError('not an error')).toBe(false);
    expect(isServerApiError(null)).toBe(false);
  });
});

describe('localizeServerError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the specific localized message for a known reason code', () => {
    const error = new FakeServerApiError(403, 'That sign-in belongs to someone else.', 'different_account');
    expect(localizeServerError(error)).toBe(
      'That sign-in belongs to a different account. Your current account was not changed.',
    );
  });

  it('returns the generic localized failure with a Support Reference for an unknown reason code', () => {
    const error = new FakeServerApiError(500, 'Raw backend failure text', 'some_unmapped_code');
    const result = localizeServerError(error);
    expect(result).toContain('Something went wrong. Please try again.');
    expect(result).toContain(supportReferenceLine(1));
  });

  it('returns the generic localized failure with a Support Reference for a null reason code', () => {
    const error = new FakeServerApiError(500, 'Raw backend failure text', null);
    const result = localizeServerError(error);
    expect(result).toContain('Something went wrong. Please try again.');
    expect(result).toContain(supportReferenceLine(1));
  });

  it('never includes the server raw message string in the returned text', () => {
    const error = new FakeServerApiError(500, 'a very specific raw backend sentence', 'unknown_code');
    expect(localizeServerError(error)).not.toContain('a very specific raw backend sentence');
  });

  it('reports the raw server message to Sentry as diagnostic context, fingerprinted by the code-shaped reason', () => {
    const error = new FakeServerApiError(500, 'a very specific raw backend sentence', 'unknown_code');
    localizeServerError(error);
    expect(capturedEvent()).toMatchObject({
      message: 'Backend error presented: unknown_code',
      fingerprint: ['server-error', 'unknown_code'],
      contexts: {
        server_error: {
          reason: 'unknown_code',
          rawMessage: 'a very specific raw backend sentence',
          status: 500,
        },
      },
    });
  });

  it('fingerprints a null reason by HTTP status', () => {
    const error = new FakeServerApiError(503, 'Service unavailable', null);
    localizeServerError(error);
    expect(capturedEvent()).toMatchObject({ message: 'Backend error presented: 503', fingerprint: ['server-error', '503'] });
  });

  it('fingerprints a code-shaped reason by that reason, not the status', () => {
    const error = new FakeServerApiError(409, 'Username unavailable', 'username_unavailable');
    localizeServerError(error);
    expect(capturedEvent()).toMatchObject({ message: 'Backend error presented: username_unavailable', fingerprint: ['server-error', 'username_unavailable'] });
  });

  it('falls back to status when reason is free English prose, not a code', () => {
    const error = new FakeServerApiError(409, 'Username is unavailable', 'Username is unavailable');
    localizeServerError(error);
    expect(capturedEvent()).toMatchObject({ message: 'Backend error presented: 409', fingerprint: ['server-error', '409'] });
  });

  it('captures once and returns the same Support Reference when the same Error object is presented twice', () => {
    const error = new FakeServerApiError(500, 'Raw backend failure text', 'unmapped');
    const first = localizeServerError(error);
    const second = localizeServerError(error);
    expect(Sentry.captureEvent).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('captures twice for two distinct Error objects with the same shape', () => {
    const errorA = new FakeServerApiError(500, 'Raw backend failure text', 'unmapped');
    const errorB = new FakeServerApiError(500, 'Raw backend failure text', 'unmapped');
    localizeServerError(errorA);
    localizeServerError(errorB);
    expect(Sentry.captureEvent).toHaveBeenCalledTimes(2);
  });

  it('does not capture a Sentry event for a recognized reason', () => {
    const error = new FakeServerApiError(403, 'That sign-in belongs to someone else.', 'different_account');
    localizeServerError(error);
    expect(Sentry.captureEvent).not.toHaveBeenCalled();
  });

  it('breadcrumbs a recognized reason with only the reason code, never the raw message', () => {
    const error = new FakeServerApiError(
      403,
      'a very specific raw backend sentence about this account',
      'different_account',
    );
    localizeServerError(error);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: 'server_error',
      level: 'info',
      data: { reason: 'different_account' },
    });
    const allBreadcrumbArgs = (Sentry.addBreadcrumb as jest.Mock).mock.calls.map((call) => JSON.stringify(call));
    expect(allBreadcrumbArgs.join('\n')).not.toContain('a very specific raw backend sentence about this account');
  });

  it('breadcrumbs a known reason only once when the same Error object is presented twice', () => {
    const error = new FakeServerApiError(403, 'x', 'different_account');
    localizeServerError(error);
    localizeServerError(error);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it('re-resolves localized text on a language switch but keeps the same Support Reference and a single capture', async () => {
    const originalLanguage = i18n.language;
    try {
      await i18n.changeLanguage('en');
      const error = new FakeServerApiError(500, 'Raw backend failure text', null);

      const englishResult = localizeServerError(error);
      await i18n.changeLanguage('tr');
      const turkishResult = localizeServerError(error);

      expect(Sentry.captureEvent).toHaveBeenCalledTimes(1);
      expect(englishResult).not.toBe(turkishResult);
      expect(englishResult).toContain('Something went wrong. Please try again.');
      expect(turkishResult).toContain('Bir şeyler ters gitti. Lütfen tekrar deneyin.');

      const reference = supportReferenceLine(1);
      expect(englishResult).toContain(reference);
      expect(turkishResult.replace('Destek Referansı', 'Support Reference')).toContain(reference);
    } finally {
      await i18n.changeLanguage(originalLanguage);
    }
  });

  it('sends one plain message event, with no synthetic exception, so Sentry titles the issue by its message', () => {
    const error = new FakeServerApiError(401, 'Unauthorized', null);
    const result = localizeServerError(error);

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureEvent).toHaveBeenCalledTimes(1);
    const event = capturedEvent();
    expect(event).toEqual({
      message: 'Backend error presented: 401',
      level: 'info',
      fingerprint: ['server-error', '401'],
      tags: { server_error_status: '401', server_error_code: '401' },
      contexts: { server_error: { reason: null, rawMessage: 'Unauthorized', status: 401 } },
    });
    expect(event).not.toHaveProperty('exception');
    expect(event).not.toHaveProperty('stacktrace');
    expect(event).not.toHaveProperty('threads');

    const eventId = (Sentry.captureEvent as jest.Mock).mock.results[0].value as string;
    expect(result).toContain(`Support Reference: SW-${eventId.toUpperCase()}`);
  });

  describe('serverErrorKey edge cases (#249 follow-up)', () => {
    it('uses a 64-character lowercase code-shaped reason as the fingerprint key', () => {
      const reason = 'a'.repeat(64);
      const error = new FakeServerApiError(400, 'x', reason);
      localizeServerError(error);
      expect(capturedEvent()).toMatchObject({ message: `Backend error presented: ${reason}`, fingerprint: ['server-error', reason] });
    });

    it('falls back to status for a 65-character reason (one over the code-shape limit)', () => {
      const reason = 'a'.repeat(65);
      const error = new FakeServerApiError(400, 'x', reason);
      localizeServerError(error);
      expect(capturedEvent()).toMatchObject({ message: 'Backend error presented: 400', fingerprint: ['server-error', '400'] });
    });

    it('falls back to status for an uppercase reason, even one that looks code-shaped', () => {
      const error = new FakeServerApiError(409, 'x', 'USERNAME_TAKEN');
      localizeServerError(error);
      expect(capturedEvent()).toMatchObject({ message: 'Backend error presented: 409', fingerprint: ['server-error', '409'] });
    });
  });
});
