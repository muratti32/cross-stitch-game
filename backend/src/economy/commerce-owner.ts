export type CommerceOwner =
  | { readonly type: 'account'; readonly accountId: string }
  | { readonly type: 'guest'; readonly guestInstallationId: string };

export interface CommerceOwnerPrincipal {
  readonly principalType: 'account' | 'guest';
  readonly principalId: string;
}

export function toCommerceOwnerPrincipal(
  owner: CommerceOwner,
): CommerceOwnerPrincipal {
  if (owner.type === 'account') {
    return { principalType: 'account', principalId: owner.accountId };
  }

  return {
    principalType: 'guest',
    principalId: owner.guestInstallationId,
  };
}

export function isValidCommerceOwner(value: unknown): value is CommerceOwner {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.type === 'account') {
    return (
      typeof candidate.accountId === 'string' &&
      candidate.accountId.length > 0 &&
      !('guestInstallationId' in candidate)
    );
  }

  if (candidate.type === 'guest') {
    return (
      typeof candidate.guestInstallationId === 'string' &&
      candidate.guestInstallationId.length > 0 &&
      !('accountId' in candidate)
    );
  }

  return false;
}
