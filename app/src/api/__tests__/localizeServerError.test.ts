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
    captureMessage: jest.fn(() => '0123456789abcdef0123456789abcdef'),
    withScope: jest.fn((callback) => callback(scope)),
  };
});

import * as Sentry from '@sentry/react-native';
import { isServerApiError, localizeServerError } from '../localizeServerError';

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
    expect(result).toContain('Support Reference: SW-0123456789ABCDEF0123456789ABCDEF');
  });

  it('returns the generic localized failure with a Support Reference for a null reason code', () => {
    const error = new FakeServerApiError(500, 'Raw backend failure text', null);
    const result = localizeServerError(error);
    expect(result).toContain('Something went wrong. Please try again.');
    expect(result).toContain('Support Reference: SW-0123456789ABCDEF0123456789ABCDEF');
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
});
