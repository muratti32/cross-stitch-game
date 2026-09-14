// captureMessage returns a distinct id per call (not a constant) so tests
// that assert "the same Support Reference" or "a new capture" are only
// meaningful because of the production dedup logic, not because the mock
// happens to always return the same value.
let mockEventIdCounter = 0;

jest.mock('@sentry/react-native', () => {
  const scope = {
    setContext: jest.fn(),
    setFingerprint: jest.fn(),
    setLevel: jest.fn(),
    setTag: jest.fn(),
  };
  return {
    __scope: scope,
    addBreadcrumb: jest.fn(),
    captureMessage: jest.fn(() => {
      mockEventIdCounter += 1;
      return mockEventIdCounter.toString(16).padStart(32, '0');
    }),
    withScope: jest.fn((callback) => callback(scope)),
  };
});

import * as Sentry from '@sentry/react-native';
import i18n from '../../i18n/i18n';
import { isServerApiError, localizeServerError } from '../localizeServerError';

/** The Support Reference string produced from the Nth (1-indexed) captureMessage call this test. */
function supportReferenceLine(callIndex: number): string {
  const mock = Sentry.captureMessage as jest.Mock;
  const eventId = mock.mock.results[callIndex - 1].value as string;
  return `Support Reference: SW-${eventId.toUpperCase()}`;
}

type MockedSentry = typeof Sentry & {
  __scope: {
    setContext: jest.Mock;
    setFingerprint: jest.Mock;
    setLevel: jest.Mock;
    setTag: jest.Mock;
  };
};

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
    expect(Sentry.captureMessage).toHaveBeenCalledWith('Backend error presented: unknown_code');
    expect(Sentry.withScope).toHaveBeenCalled();
    const scope = (Sentry as MockedSentry).__scope;
    expect(scope.setContext).toHaveBeenCalledWith('server_error', {
      reason: 'unknown_code',
      rawMessage: 'a very specific raw backend sentence',
      status: 500,
    });
    expect(scope.setFingerprint).toHaveBeenCalledWith(['server-error', 'unknown_code']);
  });

  it('fingerprints a null reason by HTTP status', () => {
    const error = new FakeServerApiError(503, 'Service unavailable', null);
    localizeServerError(error);
    const scope = (Sentry as MockedSentry).__scope;
    expect(scope.setFingerprint).toHaveBeenCalledWith(['server-error', '503']);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('Backend error presented: 503');
  });

  it('fingerprints a code-shaped reason by that reason, not the status', () => {
    const error = new FakeServerApiError(409, 'Username unavailable', 'username_unavailable');
    localizeServerError(error);
    const scope = (Sentry as MockedSentry).__scope;
    expect(scope.setFingerprint).toHaveBeenCalledWith(['server-error', 'username_unavailable']);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('Backend error presented: username_unavailable');
  });

  it('falls back to status when reason is free English prose, not a code', () => {
    const error = new FakeServerApiError(409, 'Username is unavailable', 'Username is unavailable');
    localizeServerError(error);
    const scope = (Sentry as MockedSentry).__scope;
    expect(scope.setFingerprint).toHaveBeenCalledWith(['server-error', '409']);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('Backend error presented: 409');
  });

  it('captures once and returns the same Support Reference when the same Error object is presented twice', () => {
    const error = new FakeServerApiError(500, 'Raw backend failure text', 'unmapped');
    const first = localizeServerError(error);
    const second = localizeServerError(error);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('captures twice for two distinct Error objects with the same shape', () => {
    const errorA = new FakeServerApiError(500, 'Raw backend failure text', 'unmapped');
    const errorB = new FakeServerApiError(500, 'Raw backend failure text', 'unmapped');
    localizeServerError(errorA);
    localizeServerError(errorB);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
  });

  it('does not capture a Sentry event for a recognized reason', () => {
    const error = new FakeServerApiError(403, 'That sign-in belongs to someone else.', 'different_account');
    localizeServerError(error);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.withScope).not.toHaveBeenCalled();
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

      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
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

  describe('serverErrorKey edge cases (#249 follow-up)', () => {
    it('uses a 64-character lowercase code-shaped reason as the fingerprint key', () => {
      const reason = 'a'.repeat(64);
      const error = new FakeServerApiError(400, 'x', reason);
      localizeServerError(error);
      const scope = (Sentry as MockedSentry).__scope;
      expect(scope.setFingerprint).toHaveBeenCalledWith(['server-error', reason]);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(`Backend error presented: ${reason}`);
    });

    it('falls back to status for a 65-character reason (one over the code-shape limit)', () => {
      const reason = 'a'.repeat(65);
      const error = new FakeServerApiError(400, 'x', reason);
      localizeServerError(error);
      const scope = (Sentry as MockedSentry).__scope;
      expect(scope.setFingerprint).toHaveBeenCalledWith(['server-error', '400']);
      expect(Sentry.captureMessage).toHaveBeenCalledWith('Backend error presented: 400');
    });

    it('falls back to status for an uppercase reason, even one that looks code-shaped', () => {
      const error = new FakeServerApiError(409, 'x', 'USERNAME_TAKEN');
      localizeServerError(error);
      const scope = (Sentry as MockedSentry).__scope;
      expect(scope.setFingerprint).toHaveBeenCalledWith(['server-error', '409']);
      expect(Sentry.captureMessage).toHaveBeenCalledWith('Backend error presented: 409');
    });
  });
});
