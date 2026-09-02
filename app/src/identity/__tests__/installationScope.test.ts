import { shouldDiscardInheritedSession } from '../installationScope';
import { emptySessionEnvelope, type SessionEnvelope } from '../sessionEnvelope';

function envelope(overrides: Partial<SessionEnvelope> = {}): SessionEnvelope {
  return { ...emptySessionEnvelope(), ...overrides };
}

describe('installation scope', () => {
  test('a fresh installation discards an inherited Sign in required gate', () => {
    expect(
      shouldDiscardInheritedSession(
        false,
        envelope({ kind: 'account', accountId: 'account-1', requiresSignIn: true }),
      ),
    ).toBe(true);
  });

  test('a marked installation keeps its own Sign in required gate', () => {
    expect(
      shouldDiscardInheritedSession(
        true,
        envelope({ kind: 'account', accountId: 'account-1', requiresSignIn: true }),
      ),
    ).toBe(false);
  });

  test('a fresh installation keeps a usable inherited session', () => {
    expect(
      shouldDiscardInheritedSession(
        false,
        envelope({ kind: 'account', accountId: 'account-1', refreshToken: 'refresh-1' }),
      ),
    ).toBe(false);
    expect(
      shouldDiscardInheritedSession(false, envelope({ kind: 'guest', guestId: 'guest-1' })),
    ).toBe(false);
  });

  test('an empty envelope needs no reconciliation either way', () => {
    expect(shouldDiscardInheritedSession(false, envelope())).toBe(false);
    expect(shouldDiscardInheritedSession(true, envelope())).toBe(false);
  });
});
