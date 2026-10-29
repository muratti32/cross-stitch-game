import { FetchError } from 'expo/src/winter/fetch/FetchErrors';
import { isOfflineNetworkError, OfflineError } from '../networkErrors';

// expo/fetch on iOS: a URLSession transport failure (NSURLErrorDomain) is
// wrapped in ExpoModulesCore's UnexpectedException, whose message keeps only
// the device-localized description, then rethrown as expo's FetchError.
function expoFetchTransportError(localizedDescription: string): FetchError {
  return FetchError.createFromError(
    new Error(`UnexpectedException: ${localizedDescription} (at ExpoModulesCore/Promise.swift:56)`),
  );
}

describe('isOfflineNetworkError', () => {
  test('classifies the iOS NSURLErrorNotConnectedToInternet message (#152 / STITCH-WISH-P)', () => {
    const error = new Error(
      'Error performing request because the internet connection appears to be offline.',
    );
    expect(isOfflineNetworkError(error)).toBe(true);
  });

  test('classifies the iOS WebKit fetch shim message (#153 / STITCH-WISH-N)', () => {
    const error = new Error('A network error has occurred. The Internet connection appears to be offline.');
    expect(isOfflineNetworkError(error)).toBe(true);
  });

  test('classifies React Native\'s own fetch polyfill message', () => {
    expect(isOfflineNetworkError(new TypeError('Network request failed'))).toBe(true);
  });

  test('matches case-insensitively', () => {
    expect(isOfflineNetworkError(new Error('NETWORK REQUEST FAILED'))).toBe(true);
  });

  test('matches as a substring within a longer message', () => {
    expect(
      isOfflineNetworkError(new Error('Request to /v1/economy/balance failed: Network request failed')),
    ).toBe(true);
  });

  test.each([
    ['French connection lost (#152 / STITCH-WISH-12)', 'La connexion réseau a été perdue.'],
    ['English connection lost', 'The network connection was lost.'],
  ])('classifies an expo/fetch iOS transport failure regardless of device language: %s', (_, description) => {
    expect(isOfflineNetworkError(expoFetchTransportError(description))).toBe(true);
  });

  test('does not classify an expo/fetch named native exception', () => {
    const redirectRefused = FetchError.createFromError(
      new Error(
        "FetchRedirectException: Redirect is not allowed when redirect mode is 'error' (at ExpoFetch/NativeResponse.swift:195)",
      ),
    );
    expect(isOfflineNetworkError(redirectRefused)).toBe(false);
  });

  test('does not classify a backend error that merely mentions a network error', () => {
    // Guards the Sentry beforeSend drop: 'a network error has occurred' on its
    // own is not proof of connectivity loss, and must never suppress a real
    // backend failure (#152 acceptance criterion).
    expect(
      isOfflineNetworkError(
        new Error('A network error has occurred while contacting the payment provider.'),
      ),
    ).toBe(false);
  });

  test('does not classify a genuine backend failure message', () => {
    expect(isOfflineNetworkError(new Error('Session error: status 500'))).toBe(false);
  });

  test('does not classify an unrelated thrown Error', () => {
    expect(isOfflineNetworkError(new Error('Unexpected token < in JSON at position 0'))).toBe(false);
  });

  test('does not classify a non-Error value', () => {
    expect(isOfflineNetworkError('Network request failed')).toBe(false);
    expect(isOfflineNetworkError(null)).toBe(false);
    expect(isOfflineNetworkError(undefined)).toBe(false);
  });
});

describe('OfflineError', () => {
  test('carries the original error as a catchable, typed error', () => {
    const original = new TypeError('Network request failed');
    const offlineError = new OfflineError(original);

    expect(offlineError).toBeInstanceOf(Error);
    expect(offlineError.name).toBe('OfflineError');
    expect(offlineError.originalError).toBe(original);
  });
});
