import { presentServerError } from '../serverErrorPresentation';
import i18n from '../../i18n/i18n';

describe('presentServerError', () => {
  it('maps a known reason code to its specific message key', () => {
    expect(presentServerError('different_account', 403)).toEqual({
      messageKey: 'errors:reauthentication.differentAccount',
    });
    expect(presentServerError('provider_rejected', 403)).toEqual({
      messageKey: 'errors:reauthentication.providerRejected',
    });
  });

  it('resolves a known reason code to the right text in both English and Turkish', () => {
    const { messageKey } = presentServerError('different_account', 403);
    expect(i18n.t(messageKey, { lng: 'en' })).toBe(
      'That sign-in belongs to a different account. Your current account was not changed.',
    );
    expect(i18n.t(messageKey, { lng: 'tr' })).toBe(
      'Bu oturum açma işlemi farklı bir hesaba ait. Mevcut hesabınız değiştirilmedi.',
    );
  });

  it('falls back to the generic failure plus a Support Reference for an unknown reason code', () => {
    const result = presentServerError('some_unmapped_backend_reason', 500);
    expect(result.messageKey).toBe('errors:generic.failure');
    expect(result.supportReference).toBe('ERR-500-SOME_UNMAPPED_BACKEND_REASON');
  });

  it('falls back to the generic failure plus a Support Reference for a null reason code', () => {
    const result = presentServerError(null, 500);
    expect(result.messageKey).toBe('errors:generic.failure');
    expect(result.supportReference).toBe('ERR-500-UNKNOWN');
  });

  it('falls back to the generic failure plus a Support Reference for an absent reason code', () => {
    const result = presentServerError(undefined, 502);
    expect(result.messageKey).toBe('errors:generic.failure');
    expect(result.supportReference).toBe('ERR-502-UNKNOWN');
  });

  it('never echoes the reason verbatim when it looks like free English prose rather than a code', () => {
    // creatorProfile.ts has observed the backend send `reason` as a full
    // English sentence on at least one path - that must not leak to the
    // player as though it were a recognized code's localized text.
    const result = presentServerError('Display name contains a reserved name', 422);
    expect(result.messageKey).toBe('errors:generic.failure');
  });
});
