import {
  FIRST_COMPLETION_TIER_COIN,
  firstCompletionReward,
  patternChartPrice,
  patternChartTier,
} from './economy.constants';

describe('firstCompletionReward', () => {
  it('grants the Small tier for 1–3,999 stitchable cells', () => {
    expect(firstCompletionReward(1)).toBe(FIRST_COMPLETION_TIER_COIN.small);
    expect(firstCompletionReward(2_000)).toBe(FIRST_COMPLETION_TIER_COIN.small);
    expect(firstCompletionReward(3_999)).toBe(FIRST_COMPLETION_TIER_COIN.small);
    expect(FIRST_COMPLETION_TIER_COIN.small).toBe(25);
  });

  it('grants the Medium tier for 4,000–14,999 stitchable cells', () => {
    expect(firstCompletionReward(4_000)).toBe(FIRST_COMPLETION_TIER_COIN.medium);
    expect(firstCompletionReward(10_000)).toBe(
      FIRST_COMPLETION_TIER_COIN.medium,
    );
    expect(firstCompletionReward(14_999)).toBe(
      FIRST_COMPLETION_TIER_COIN.medium,
    );
    expect(FIRST_COMPLETION_TIER_COIN.medium).toBe(60);
  });

  it('grants the Large tier for 15,000+ stitchable cells', () => {
    expect(firstCompletionReward(15_000)).toBe(FIRST_COMPLETION_TIER_COIN.large);
    expect(firstCompletionReward(1_000_000)).toBe(
      FIRST_COMPLETION_TIER_COIN.large,
    );
    expect(FIRST_COMPLETION_TIER_COIN.large).toBe(120);
  });
});

describe('patternChartPrice', () => {
  it('prices Small 20, Medium 40, Large 60 on the Completion Reward Tier boundaries', () => {
    expect(patternChartPrice(1)).toBe(20);
    expect(patternChartPrice(3_999)).toBe(20);
    expect(patternChartPrice(4_000)).toBe(40);
    expect(patternChartPrice(14_999)).toBe(40);
    expect(patternChartPrice(15_000)).toBe(60);
    expect(patternChartTier(15_000)).toBe('large');
  });
});
