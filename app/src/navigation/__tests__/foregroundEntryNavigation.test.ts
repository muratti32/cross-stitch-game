import {
  applyForegroundEntryDecision,
  foregroundEntryCoordinator,
  handleForegroundLifecycle,
} from '../foregroundEntryNavigation';

describe('foreground entry navigation seam', () => {
  beforeEach(() => {
    foregroundEntryCoordinator.clearProtectedRoundTrip();
    foregroundEntryCoordinator.clearInboundNavigationPending();
    foregroundEntryCoordinator.onLifecycleChange('active');
  });

  it('selects the catalog tab without dismissing its nested stack', () => {
    const router = { navigate: jest.fn() };
    foregroundEntryCoordinator.onLifecycleChange('background');
    const decision = handleForegroundLifecycle('active', {}, router, '/(tabs)/(profile)');
    expect(decision?.action).toBe('select-catalog');
    expect(router.navigate).toHaveBeenCalledWith('/(tabs)/(catalog)');
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
    const decision = handleForegroundLifecycle('active', {}, router, '/(tabs)/(profile)');
    expect(decision).toEqual({ action: 'preserve-current-route', reason: 'pending-inbound-navigation' });
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
