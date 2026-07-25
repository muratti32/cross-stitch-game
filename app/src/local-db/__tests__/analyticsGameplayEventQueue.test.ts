import {
  ANALYTICS_GAMEPLAY_EVENT_QUEUE_CAP,
  analyticsGameplayEventQueueOverflow,
} from '../index';

describe('analytics gameplay event queue cap', () => {
  it('drops only the oldest overflow records once the bounded cap is exceeded', () => {
    expect(analyticsGameplayEventQueueOverflow(ANALYTICS_GAMEPLAY_EVENT_QUEUE_CAP)).toBe(0);
    expect(analyticsGameplayEventQueueOverflow(ANALYTICS_GAMEPLAY_EVENT_QUEUE_CAP + 1)).toBe(1);
    expect(analyticsGameplayEventQueueOverflow(ANALYTICS_GAMEPLAY_EVENT_QUEUE_CAP + 25)).toBe(25);
  });
});
