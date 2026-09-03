import { useIdentityStore, type IdentityState } from './guestIdentity';

/**
 * The opaque player reference (CONTEXT.md "Support Reference"): the Registered
 * Account id when one is signed in, the Guest Installation Identity otherwise,
 * and null before either exists. It is the ONLY player identifier permitted to
 * leave the device for observability or analytics - never an email address, a
 * Firebase UID, or an auth-provider subject (ADR-0035, ADR-0038).
 *
 * Derived in one place so every consumer reports the same reference and the
 * precedence cannot drift between them.
 */
export function getOpaquePlayerReference(
  state: Pick<IdentityState, 'accountId' | 'guestId'> = useIdentityStore.getState(),
): string | null {
  return state.accountId ?? state.guestId;
}

/**
 * Applies the current opaque player reference and then re-applies it whenever
 * identity changes - a Guest promoted to a Registered Account, a sign-out - so
 * consumers do not have to be wired into every call site that changes identity.
 */
export function subscribeToOpaquePlayerReference(
  apply: (opaqueId: string | null) => void,
): void {
  apply(getOpaquePlayerReference());
  useIdentityStore.subscribe((state, prevState) => {
    if (state.accountId !== prevState.accountId || state.guestId !== prevState.guestId) {
      apply(getOpaquePlayerReference(state));
    }
  });
}
