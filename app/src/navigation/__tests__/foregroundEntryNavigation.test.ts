import {
  applyForegroundEntryDecision,
  foregroundEntryCoordinator,
  handleForegroundLifecycle,
  isApplicationInboundUrl,
  isActiveStitchingSessionRoute,
  isRootEntryPrepared,
  withProtectedRoundTrip,
} from '../foregroundEntryNavigation';

describe('foreground entry navigation seam', () => {
  beforeEach(() => {
    foregroundEntryCoordinator.clearProtectedRoundTrip();
    foregroundEntryCoordinator.clearInboundNavigationPending();
    foregroundEntryCoordinator.onLifecycleChange('active');
  });

  it('waits for database and onboarding preparation before root routing', () => {
    expect(isRootEntryPrepared(false, 'absent')).toBe(false);
    expect(isRootEntryPrepared(true, 'absent')).toBe(false);
    expect(isRootEntryPrepared(true, 'complete')).toBe(true);
  });

  it('selects the catalog tab without dismissing its nested stack', () => {
    const router = { navigate: jest.fn() };
    foregroundEntryCoordinator.onLifecycleChange('background');
    const decision = handleForegroundLifecycle('active', {}, router, '/profile', ['(tabs)', '(profile)']);
    expect(decision?.action).toBe('select-catalog');
    expect(router.navigate).toHaveBeenCalledWith('/(tabs)/(catalog)');
  });

  it('protects only a concrete stitching session, not the Stitch list', () => {
    expect(isActiveStitchingSessionRoute(['(tabs)', '(play)', 'index'])).toBe(false);
    expect(isActiveStitchingSessionRoute(['(tabs)', '(play)', '[sessionId]'])).toBe(true);
  });

  it('ignores the Expo Dev Client bootstrap URL as an inbound app route', () => {
    expect(isApplicationInboundUrl('exp+stitch-wish://expo-development-client/?url=http://localhost:8081')).toBe(false);
    expect(isApplicationInboundUrl('stitchwish://pattern/123')).toBe(true);
    expect(isApplicationInboundUrl('https://stitchwish.avkdesign.net/pattern/123')).toBe(true);
  });

  it('leaves a nested catalog route and every already-active catalog route untouched', () => {
    const router = { navigate: jest.fn() };
    applyForegroundEntryDecision(
      { action: 'select-catalog', reason: 'ordinary-return' },
      router,
      '/(tabs)/(catalog)/search',
    );
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('lets an inbound URL win when delivered before app active', () => {
    const router = { navigate: jest.fn() };
    foregroundEntryCoordinator.markInboundNavigationPending();
    foregroundEntryCoordinator.onLifecycleChange('background');
    const decision = handleForegroundLifecycle('active', {}, router, '/profile', ['(tabs)', '(profile)']);
    expect(decision).toEqual({ action: 'preserve-current-route', reason: 'pending-inbound-navigation' });
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('keeps a protected round trip through an early-resolving native promise', async () => {
    const router = { navigate: jest.fn() };
    await withProtectedRoundTrip('external-link', async () => 'launched');
    foregroundEntryCoordinator.onLifecycleChange('background');
    const decision = handleForegroundLifecycle('active', {}, router, '/profile', ['(tabs)', '(profile)']);
    expect(decision?.reason).toBe('protected-round-trip');
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
