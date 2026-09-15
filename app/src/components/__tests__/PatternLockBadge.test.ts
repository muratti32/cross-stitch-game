import { patternLockState } from '../PatternLockBadge';

describe('patternLockState', () => {
  it('hides for free patterns', () => {
    expect(patternLockState(null, 'free', new Set())).toEqual({ locked: false });
  });

  it('shows the tier price for a known locked paid pattern', () => {
    expect(patternLockState('medium', 'paid', new Set())).toEqual({ locked: true, price: 150 });
  });

  it.each(['paid', 'grandfathered'])('hides for an owned %s pattern', (id) => {
    expect(patternLockState('large', id, new Set([id]))).toEqual({ locked: false });
  });

  it('hides while unlock ownership is unknown', () => {
    expect(patternLockState('small', 'paid', null)).toEqual({ locked: false });
  });
});
