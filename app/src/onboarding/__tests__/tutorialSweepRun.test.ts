import { findTutorialSweepRunStart } from '../tutorialSweepRun';

it('targets the longest unfinished matching run, not an earlier shorter run', () => {
  const grid = Uint8Array.from([
    2, 2, 2, 0, 2, 2, 2, 2, 2,
  ]);

  expect(findTutorialSweepRunStart(grid, 9, 1, 1, () => false)).toBe(4);
});

it('requires three unfinished matching cells', () => {
  const grid = Uint8Array.from([2, 2, 2, 2]);

  expect(findTutorialSweepRunStart(grid, 4, 1, 1, (index) => index === 1)).toBe(-1);
});
