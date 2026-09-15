import { captureGameplayEvent } from '../gameplayEvents';
import { patternUnlocked, recordUnlockResult, shouldEmitUnlockPrompt, unlockGetCoinsTapped, unlockInsufficientCoins, unlockPromptShown, unlockShortfall } from '../patternUnlock';

jest.mock('../gameplayEvents', () => ({ captureGameplayEvent: jest.fn() }));

const capture = captureGameplayEvent as jest.MockedFunction<typeof captureGameplayEvent>;

describe('pattern unlock analytics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('captures each exact kind and payload fire-and-forget', () => {
    unlockPromptShown('small', 75);
    patternUnlocked('medium', 150);
    unlockInsufficientCoins('large', 25);
    unlockGetCoinsTapped('large', 25);

    expect(capture.mock.calls).toEqual([
      ['unlock_prompt_shown', { tier: 'small', price: 75 }],
      ['pattern_unlocked', { tier: 'medium', price: 150 }],
      ['unlock_insufficient_coins', { tier: 'large', shortfall: 25 }],
      ['unlock_get_coins_tapped', { tier: 'large', shortfall: 25 }],
    ]);
  });

  it.each([
    ['unlocks loading', { unlocksLoaded: false }],
    ['unlocks errored', { unlocksLoaded: false }],
    ['free pattern', { tier: null }],
    ['owned pattern', { owned: true }],
    ['grandfathered pattern', { owned: true }],
    ['unauthenticated player', { isAuthenticated: false }],
    ['re-render after prompt', { alreadyPrompted: true }],
    ['insufficient-coins Back after prompt', { alreadyPrompted: true }],
    ['open insufficient-coins panel', { insufficientPanelOpen: true }],
  ] as const)('suppresses prompt while %s', (_label, overrides) => {
    expect(shouldEmitUnlockPrompt({
      isAuthenticated: true, unlocksLoaded: true, tier: 'small', owned: false,
      insufficientPanelOpen: false, alreadyPrompted: false, ...overrides,
    })).toBe(false);
  });

  it('emits unlock only for a newly created paid unlock', () => {
    recordUnlockResult('small', { alreadyUnlocked: false });
    recordUnlockResult('medium', { alreadyUnlocked: true });
    recordUnlockResult(null, { alreadyUnlocked: false });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('pattern_unlocked', { tier: 'small', price: 75 });
  });

  it.each([[100, 75, 25], [100, 100, null], [100, 125, null], [100.5, 75, null]])(
    'returns a positive integer shortfall for %s minus %s',
    (price, balance, expected) => expect(unlockShortfall(price, balance)).toBe(expected),
  );
});
