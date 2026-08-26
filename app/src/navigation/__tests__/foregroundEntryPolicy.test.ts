import {
  decideForegroundEntry,
  ForegroundEntryCoordinator,
} from '../foregroundEntryPolicy';

describe('foreground entry policy', () => {
  it('selects Catalog for the first active event of a fresh app process', () => {
    const coordinator = new ForegroundEntryCoordinator();

    expect(coordinator.onLifecycleChange('active')).toEqual({
      action: 'select-catalog',
      reason: 'ordinary-return',
    });
  });

  it.each([
    ['ordinary return', { ordinaryReturn: true }, 'select-catalog', 'ordinary-return'],
    ['transient inactive', { ordinaryReturn: false }, 'preserve-current-route', 'transient-inactive'],
    ['active Stitching Session', { ordinaryReturn: true, activeStitchingSession: true }, 'preserve-current-route', 'active-stitching-session'],
    ['required sign-in', { ordinaryReturn: true, requiresSignIn: true }, 'preserve-current-route', 'required-sign-in'],
    ['pending inbound navigation', { ordinaryReturn: true, pendingInboundNavigation: true }, 'preserve-current-route', 'pending-inbound-navigation'],
  ])('%s has the expected decision', (_label, context, action, reason) => {
    expect(decideForegroundEntry(context)).toEqual({ action, reason });
  });

  it.each([
    ['absent', 'select-welcome'],
    ['welcome', 'select-welcome'],
    ['deferred', 'select-catalog'],
    ['complete', 'select-catalog'],
  ] as const)('routes onboarding %s to %s', (onboardingPosition, action) => {
    expect(decideForegroundEntry({ ordinaryReturn: true, onboardingPosition }).action).toBe(action);
  });

  it('keeps sign-in and an active session ahead of onboarding', () => {
    expect(decideForegroundEntry({ ordinaryReturn: true, onboardingPosition: 'absent', requiresSignIn: true }).reason).toBe('required-sign-in');
    expect(decideForegroundEntry({ ordinaryReturn: true, onboardingPosition: 'welcome', activeStitchingSession: true }).reason).toBe('active-stitching-session');
  });

  it('lets explicit inbound navigation win over every other foreground default', () => {
    expect(decideForegroundEntry({
      ordinaryReturn: true,
      pendingInboundNavigation: true,
      requiresSignIn: true,
      activeStitchingSession: true,
    })).toEqual({ action: 'preserve-current-route', reason: 'pending-inbound-navigation' });
  });

  it('covers all application-owned protected round trips without selecting Catalog', () => {
    const coordinator = new ForegroundEntryCoordinator();
    for (const kind of [
      'photo-picker',
      'permission',
      'authentication',
      'commerce',
      'subscription-management',
      'external-link',
    ] as const) {
      coordinator.beginProtectedRoundTrip(kind);
      coordinator.onLifecycleChange('inactive');
      expect(coordinator.onLifecycleChange('active')).toEqual({
        action: 'preserve-current-route',
        reason: 'protected-round-trip',
      });
      expect(coordinator.getProtectedRoundTrip()).toBeUndefined();
    }
  });

  it('preserves inactive -> active but selects Catalog for background -> active', () => {
    const coordinator = new ForegroundEntryCoordinator();
    coordinator.onLifecycleChange('inactive');
    expect(coordinator.onLifecycleChange('active')).toEqual({
      action: 'preserve-current-route',
      reason: 'transient-inactive',
    });

    coordinator.onLifecycleChange('background');
    coordinator.onLifecycleChange('inactive');
    expect(coordinator.onLifecycleChange('active')).toEqual({
      action: 'select-catalog',
      reason: 'ordinary-return',
    });
  });

  it('selects Catalog even when the ordinary return was brief and handles screen-lock returns', () => {
    const coordinator = new ForegroundEntryCoordinator();
    coordinator.onLifecycleChange('background');
    expect(coordinator.onLifecycleChange('active')).toEqual({
      action: 'select-catalog',
      reason: 'ordinary-return',
    });

    coordinator.onLifecycleChange('background');
    expect(coordinator.onLifecycleChange('active')).toEqual({
      action: 'select-catalog',
      reason: 'ordinary-return',
    });
  });

  it('does not let a consumed round trip suppress a later genuine return', () => {
    const coordinator = new ForegroundEntryCoordinator();
    coordinator.beginProtectedRoundTrip('permission');
    expect(coordinator.onLifecycleChange('active')).toEqual({
      action: 'preserve-current-route',
      reason: 'protected-round-trip',
    });
    coordinator.onLifecycleChange('background');
    expect(coordinator.onLifecycleChange('active')).toEqual({
      action: 'select-catalog',
      reason: 'ordinary-return',
    });
  });

  it('clears a token deterministically and does not clear a replacement token', () => {
    const coordinator = new ForegroundEntryCoordinator();
    const first = coordinator.beginProtectedRoundTrip('commerce');
    const second = coordinator.beginProtectedRoundTrip('external-link');
    coordinator.clearProtectedRoundTrip(first.token);
    expect(coordinator.getProtectedRoundTrip()).toEqual(second);
    coordinator.clearProtectedRoundTrip(second.token);
    expect(coordinator.getProtectedRoundTrip()).toBeUndefined();
  });
});
