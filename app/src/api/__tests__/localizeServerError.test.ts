jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
}));

import * as Sentry from '@sentry/react-native';
import { isServerApiError, localizeServerError } from '../localizeServerError';

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
    expect(result).toContain('Support Reference: ERR-500-SOME_UNMAPPED_CODE');
  });

  it('returns the generic localized failure with a Support Reference for a null reason code', () => {
    const error = new FakeServerApiError(500, 'Raw backend failure text', null);
    const result = localizeServerError(error);
    expect(result).toContain('Something went wrong. Please try again.');
    expect(result).toContain('Support Reference: ERR-500-UNKNOWN');
  });

  it('never includes the server raw message string in the returned text', () => {
    const error = new FakeServerApiError(500, 'a very specific raw backend sentence', 'unknown_code');
    expect(localizeServerError(error)).not.toContain('a very specific raw backend sentence');
  });

  it('reports the raw server message to Sentry as diagnostic context', () => {
    const error = new FakeServerApiError(500, 'a very specific raw backend sentence', 'unknown_code');
    localizeServerError(error);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'server-error',
        data: expect.objectContaining({
          status: 500,
          reason: 'unknown_code',
          rawMessage: 'a very specific raw backend sentence',
        }),
      }),
    );
  });
});
