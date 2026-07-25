import type { SentryEnvironmentVariables } from '../config';
import { initializeSentry, type NodeOptions } from './sentry';
import { scrubSentryEvent, type SentryEvent } from './sentry-scrubber';

describe('Sentry scrubber', () => {
  it('redacts sensitive nested values and breadcrumb data', () => {
    const event: SentryEvent = {
      breadcrumbs: [
        {
          category: 'app.action',
          data: {
            nested: {
              falRequestId: 'fal-request-id',
              patternBytes: 'pattern-bytes',
            },
            values: [
              { emailAddress: 'player@example.test' },
              { firebaseSubject: 'firebase-subject' },
            ],
          },
        },
      ],
      contexts: {
        requestContext: {
          providerId: 'provider-id',
          revenuecatAppUserId: 'revenuecat-app-user-id',
        },
      },
      extra: {
        artworkUrl: 'artwork-url',
        nested: {
          otpValue: '123456',
          promptText: 'private prompt',
          values: [
            { email: 'player@example.test' },
            { falRequestId: 'fal-request-id' },
          ],
        },
        patternBytes: 'pattern-bytes',
      },
      request: {
        cookies: { session: 'secret' },
        data: 'otp=123456',
        headers: { authorization: 'Bearer token' },
        query_string: 'code=123456',
      },
      tags: {
        firebaseSubject: 'firebase-subject',
        jobKind: 'conversion',
        revenuecatAppUserId: 'revenuecat-app-user-id',
      },
      user: {
        email: 'player@example.test',
        id: '9c740d0e-6d22-42b9-b8f1-3d0bfac15ad3',
        username: 'firebase-subject',
      },
      type: undefined,
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.user).toEqual({
      id: '9c740d0e-6d22-42b9-b8f1-3d0bfac15ad3',
    });
    expect(scrubbed.extra).toEqual({
      artworkUrl: '[Scrubbed]',
      nested: {
        otpValue: '[Scrubbed]',
        promptText: '[Scrubbed]',
        values: [
          { email: '[Scrubbed]' },
          { falRequestId: '[Scrubbed]' },
        ],
      },
      patternBytes: '[Scrubbed]',
    });
    expect(scrubbed.contexts).toEqual({
      requestContext: {
        providerId: '[Scrubbed]',
        revenuecatAppUserId: '[Scrubbed]',
      },
    });
    expect(scrubbed.tags).toEqual({
      firebaseSubject: '[Scrubbed]',
      jobKind: 'conversion',
      revenuecatAppUserId: '[Scrubbed]',
    });
    expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({
      nested: {
        falRequestId: '[Scrubbed]',
        patternBytes: '[Scrubbed]',
      },
      values: [
        { emailAddress: '[Scrubbed]' },
        { firebaseSubject: '[Scrubbed]' },
      ],
    });
  });

  it('keeps message and exception text diagnosable while redacting secrets in it', () => {
    const event: SentryEvent = {
      exception: {
        values: [
          {
            type: 'Error',
            value:
              'RevenueCat rejected the delivery for player@example.test with Bearer test-token-placeholder',
          },
        ],
      },
      message: 'Queue depth breached: 412 pending Processing Jobs',
      type: undefined,
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.message).toBe(
      'Queue depth breached: 412 pending Processing Jobs',
    );
    expect(scrubbed.exception?.values?.[0]?.value).toBe(
      'RevenueCat rejected the delivery for [Scrubbed] with [Scrubbed]',
    );
  });

  it('truncates long free text so a prompt cannot ride along in a message', () => {
    const event: SentryEvent = {
      message: `prefix ${'a b '.repeat(400)}`,
      type: undefined,
    };

    const scrubbed = scrubSentryEvent(event);

    expect(typeof scrubbed.message).toBe('string');
    expect(scrubbed.message as string).toHaveLength(512 + '…[Truncated]'.length);
    expect(scrubbed.message as string).toMatch(/…\[Truncated\]$/);
  });

  it('keeps protocol and domain codes that carry no player data', () => {
    const event: SentryEvent = {
      extra: {
        errorCode: 'ECONNRESET',
        otpCode: '123456',
        statusCode: 503,
      },
      type: undefined,
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.extra).toEqual({
      errorCode: 'ECONNRESET',
      otpCode: '[Scrubbed]',
      statusCode: 503,
    });
  });

  it('does not initialize Sentry without a DSN', () => {
    const init = jest.fn<unknown, [NodeOptions]>();
    const config: SentryEnvironmentVariables = {
      SENTRY_DSN: undefined,
      SENTRY_ENVIRONMENT: 'test',
      SENTRY_RELEASE: undefined,
      SENTRY_TRACES_SAMPLE_RATE: 1,
    };

    expect(initializeSentry(config, { init })).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });
});
