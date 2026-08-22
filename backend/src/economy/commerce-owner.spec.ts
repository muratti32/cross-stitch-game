import {
  isValidCommerceOwner,
  toCommerceOwnerPrincipal,
} from './commerce-owner';

describe('CommerceOwner', () => {
  it('accepts a valid account owner', () => {
    expect(isValidCommerceOwner({ type: 'account', accountId: 'account-1' })).toBe(
      true,
    );
  });

  it('accepts a valid guest owner', () => {
    expect(
      isValidCommerceOwner({
        type: 'guest',
        guestInstallationId: 'guest-1',
      }),
    ).toBe(true);
  });

  it('rejects both ids being present', () => {
    expect(
      isValidCommerceOwner({
        type: 'account',
        accountId: 'account-1',
        guestInstallationId: 'guest-1',
      }),
    ).toBe(false);
  });

  it('rejects neither id being present', () => {
    expect(isValidCommerceOwner({ type: 'account' })).toBe(false);
    expect(isValidCommerceOwner({ type: 'guest' })).toBe(false);
  });

  it('rejects an empty string id', () => {
    expect(isValidCommerceOwner({ type: 'account', accountId: '' })).toBe(false);
    expect(
      isValidCommerceOwner({ type: 'guest', guestInstallationId: '' }),
    ).toBe(false);
  });

  it('rejects a wrong type value', () => {
    expect(isValidCommerceOwner({ type: 'account', accountId: 123 })).toBe(false);
    expect(isValidCommerceOwner({ type: 'other', accountId: 'account-1' })).toBe(
      false,
    );
  });

  it('maps account and guest owners to principal values', () => {
    expect(
      toCommerceOwnerPrincipal({ type: 'account', accountId: 'account-1' }),
    ).toEqual({ principalType: 'account', principalId: 'account-1' });
    expect(
      toCommerceOwnerPrincipal({
        type: 'guest',
        guestInstallationId: 'guest-1',
      }),
    ).toEqual({ principalType: 'guest', principalId: 'guest-1' });
  });
});
