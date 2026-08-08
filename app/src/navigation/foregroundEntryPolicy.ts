/**
 * The decision made when the application becomes active.
 *
 * This module intentionally contains no router or tab-bar calls.  It is the
 * behaviour seam consumed by the navigation integration (and is therefore
 * safe to exercise without mounting a running application).
 */

export type ForegroundEntryAction = 'select-catalog' | 'preserve-current-route';

export type ForegroundEntryReason =
  | 'ordinary-return'
  | 'transient-inactive'
  | 'active-stitching-session'
  | 'required-sign-in'
  | 'pending-inbound-navigation'
  | 'protected-round-trip';

export type ProtectedRoundTripKind =
  | 'photo-picker'
  | 'permission'
  | 'authentication'
  | 'commerce'
  | 'subscription-management'
  | 'external-link';

export interface ProtectedRoundTrip {
  readonly kind: ProtectedRoundTripKind;
  readonly token: number;
}

export interface ForegroundEntryDecision {
  readonly action: ForegroundEntryAction;
  readonly reason: ForegroundEntryReason;
}

export interface ForegroundEntryContext {
  /** True only when the settled lifecycle state was background. */
  readonly ordinaryReturn: boolean;
  readonly activeStitchingSession?: boolean;
  readonly requiresSignIn?: boolean;
  /** An inbound universal/custom-scheme/deep-link intent not yet handled. */
  readonly pendingInboundNavigation?: boolean;
  readonly protectedRoundTrip?: ProtectedRoundTrip;
}

/**
 * Pure policy seam.  Explicit navigation and protected application-owned
 * round trips take precedence over the ordinary foreground default.
 */
export function decideForegroundEntry(
  context: ForegroundEntryContext,
): ForegroundEntryDecision {
  if (context.pendingInboundNavigation === true) {
    return { action: 'preserve-current-route', reason: 'pending-inbound-navigation' };
  }
  if (context.requiresSignIn === true) {
    return { action: 'preserve-current-route', reason: 'required-sign-in' };
  }
  if (context.activeStitchingSession === true) {
    return { action: 'preserve-current-route', reason: 'active-stitching-session' };
  }
  if (context.protectedRoundTrip) {
    return { action: 'preserve-current-route', reason: 'protected-round-trip' };
  }
  if (context.ordinaryReturn) {
    return { action: 'select-catalog', reason: 'ordinary-return' };
  }
  return { action: 'preserve-current-route', reason: 'transient-inactive' };
}

type SettledLifecycleState = 'initial' | 'active' | 'background';
export type LifecycleStatus = 'active' | 'inactive' | 'background' | 'unknown';

export interface LifecycleEntryContext {
  readonly activeStitchingSession?: boolean;
  readonly requiresSignIn?: boolean;
  readonly pendingInboundNavigation?: boolean;
}

/**
 * Tracks only settled foreground/background state.  Inactive is a transient
 * native state (Notification Center, Control Center, permissions, etc.) and
 * must not turn an ordinary return into a Catalog selection.
 */
export class ForegroundEntryCoordinator {
  // Treat the first settled active event as the app's initial entry. React
  // Native commonly reports `active` before this listener is mounted, so the
  // root lifecycle bridge also evaluates AppState.currentState on startup.
  private settledState: SettledLifecycleState = 'initial';
  private protectedRoundTrip: ProtectedRoundTrip | undefined;
  private nextRoundTripToken = 1;
  private pendingInboundNavigation = false;

  /** Mark an explicit deep-link intent before the native active event arrives. */
  markInboundNavigationPending(): void {
    this.pendingInboundNavigation = true;
  }

  clearInboundNavigationPending(): void {
    this.pendingInboundNavigation = false;
  }

  beginProtectedRoundTrip(kind: ProtectedRoundTripKind): ProtectedRoundTrip {
    const roundTrip = { kind, token: this.nextRoundTripToken++ };
    this.protectedRoundTrip = roundTrip;
    return roundTrip;
  }

  clearProtectedRoundTrip(token?: number): void {
    if (token === undefined || this.protectedRoundTrip?.token === token) {
      this.protectedRoundTrip = undefined;
    }
  }

  getProtectedRoundTrip(): ProtectedRoundTrip | undefined {
    return this.protectedRoundTrip;
  }

  /**
   * Returns a decision only for an active event.  A protected token is
   * consumed deterministically on that first active event, even when it
   * preserves the initiating route, so it cannot suppress a later genuine
   * background return.
   */
  onLifecycleChange(
    nextState: LifecycleStatus,
    context: LifecycleEntryContext = {},
  ): ForegroundEntryDecision | undefined {
    if (nextState === 'background') {
      this.settledState = 'background';
      return undefined;
    }
    if (nextState === 'inactive') {
      // A transient interruption before the first active callback must not be
      // mistaken for a background return. A real background state remains
      // settled until the subsequent active event.
      if (this.settledState === 'initial') this.settledState = 'active';
      return undefined;
    }
    if (nextState !== 'active') {
      return undefined;
    }

    const decision = decideForegroundEntry({
      ordinaryReturn:
        this.settledState === 'initial' || this.settledState === 'background',
      activeStitchingSession: context.activeStitchingSession ?? false,
      requiresSignIn: context.requiresSignIn ?? false,
      pendingInboundNavigation:
        context.pendingInboundNavigation ?? this.pendingInboundNavigation,
      protectedRoundTrip: this.protectedRoundTrip,
    });

    this.settledState = 'active';
    this.protectedRoundTrip = undefined;
    this.pendingInboundNavigation = false;
    return decision;
  }
}
