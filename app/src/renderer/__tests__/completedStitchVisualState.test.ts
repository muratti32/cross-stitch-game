import {
  CompletedStitchVisualState,
  MAX_ACTIVE_COMPLETED_STITCHES,
  deriveThreadSurfaceColors,
} from '../completedStitchVisualState';
import { MEMBERSHIP_THEMES } from '../../membership/themes';

const theme = { finish: 'matte' as const };
const color = '#123456';

describe('Completed Stitch visual state', () => {
  test('locally places a near stitch, then settles it without its number', () => {
    const state = new CompletedStitchVisualState();
    state.place(7, 'local', 'readable', 0, false);

    expect(state.get(7, true, 'readable', color, theme, 0)).toMatchObject({
      phase: 'placing', progress: 0, representation: 'textured-cross', showThreadNumber: false,
    });
    expect(state.get(7, true, 'readable', color, theme, 70)).toMatchObject({
      phase: 'placing', progress: 0.5, isDynamic: true,
    });
    expect(state.advance(140)).toEqual([7]);
    expect(state.get(7, true, 'readable', color, theme, 140)).toMatchObject({
      phase: 'settled', progress: 1, showThreadNumber: false, isDynamic: false,
    });
  });

  test('sweep placements progress independently and do not queue', () => {
    const state = new CompletedStitchVisualState();
    state.place(1, 'local', 'readable', 0, false);
    state.place(2, 'local', 'readable', 40, false);
    state.place(3, 'local', 'readable', 80, false);

    expect(state.get(1, true, 'readable', color, theme, 80).progress).toBeCloseTo(80 / 140);
    expect(state.get(2, true, 'readable', color, theme, 80).progress).toBeCloseTo(40 / 140);
    expect(state.get(3, true, 'readable', color, theme, 80).progress).toBe(0);
  });

  test('re-placing an active cell does not restart its placement timeline', () => {
    const state = new CompletedStitchVisualState();
    state.place(7, 'local', 'readable', 0, false);

    expect(state.place(7, 'local', 'readable', 70, false)).toEqual([]);
    expect(state.get(7, true, 'readable', color, theme, 105).progress).toBeCloseTo(0.75);
  });

  test('advance settles every completed placement once and cleans up active visuals', () => {
    const state = new CompletedStitchVisualState();
    state.place(1, 'local', 'readable', 0, false);
    state.place(2, 'local', 'readable', 40, false);
    state.place(3, 'local', 'readable', 80, false);

    expect(state.advance(220)).toEqual([1, 2, 3]);
    expect(state.advance(220)).toEqual([]);
    expect(state.hasActiveVisuals).toBe(false);
  });

  test('undo reverses an in-flight placement from its current visible progress', () => {
    const state = new CompletedStitchVisualState();
    state.place(3, 'local', 'readable', 0, false);
    state.undo(3, 70, false);

    expect(state.get(3, false, 'readable', color, theme, 70)).toMatchObject({
      phase: 'removing', progress: 0.5, showThreadNumber: false,
    });
    expect(state.get(3, false, 'readable', color, theme, 125).progress).toBeCloseTo(0.25);
    expect(state.advance(180)).toEqual([3]);
    expect(state.get(3, false, 'readable', color, theme, 180)).toMatchObject({
      phase: 'hidden', progress: 0, showThreadNumber: true,
    });
  });

  test('re-placing a removing cell resumes from its current visible progress', () => {
    const state = new CompletedStitchVisualState();
    state.place(3, 'local', 'readable', 0, false);
    state.undo(3, 70, false);

    const beforeRePlace = state.get(3, false, 'readable', color, theme, 100).progress;
    expect(state.get(3, false, 'readable', color, theme, 100)).toMatchObject({
      phase: 'removing',
      progress: beforeRePlace,
    });

    expect(state.place(3, 'local', 'readable', 100, false)).toEqual([]);
    expect(state.get(3, true, 'readable', color, theme, 100)).toMatchObject({
      phase: 'placing',
    });
    expect(state.get(3, true, 'readable', color, theme, 100).progress).toBeGreaterThanOrEqual(beforeRePlace);
    expect(state.get(3, true, 'readable', color, theme, 170).progress).toBeGreaterThan(beforeRePlace);

    expect(state.advance(240)).toEqual([3]);
    expect(state.get(3, true, 'readable', color, theme, 240)).toMatchObject({
      phase: 'settled',
      progress: 1,
    });
  });

  test('reduce motion, restored, and synchronized completion are settled immediately', () => {
    const state = new CompletedStitchVisualState();
    state.place(1, 'local', 'readable', 0, true);
    state.place(2, 'restored', 'readable', 0, false);
    state.place(3, 'synchronized', 'readable', 0, false);

    for (const cellIndex of [1, 2, 3]) {
      expect(state.get(cellIndex, true, 'readable', color, theme, 0)).toMatchObject({
        phase: 'settled', progress: 1, isDynamic: false,
      });
    }
  });

  test('places the lower strand first and removes the upper strand first', () => {
    const state = new CompletedStitchVisualState();
    state.place(1, 'local', 'readable', 0, false);

    expect(state.get(1, true, 'readable', color, theme, 35)).toMatchObject({
      lowerStrandProgress: 0.5,
      upperStrandProgress: 0,
    });
    expect(state.get(1, true, 'readable', color, theme, 105)).toMatchObject({
      lowerStrandProgress: 1,
      upperStrandProgress: 0.5,
    });

    state.undo(1, 105, false);
    expect(state.get(1, false, 'readable', color, theme, 105)).toMatchObject({
      lowerStrandProgress: 1,
      upperStrandProgress: 0.5,
    });
    expect(state.get(1, false, 'readable', color, theme, 160).upperStrandProgress).toBe(0);
    expect(state.get(1, false, 'readable', color, theme, 160).lowerStrandProgress).toBeCloseTo(0.75);
  });

  test('far LOD and reduce motion never create active motion', () => {
    const state = new CompletedStitchVisualState();
    state.place(1, 'local', 'out', 0, false);
    state.place(2, 'local', 'readable', 0, true);

    expect(state.hasActiveVisuals).toBe(false);
    expect(state.get(1, true, 'out', color, theme, 0)).toMatchObject({
      phase: 'settled', representation: 'mosaic', isDynamic: false,
    });
  });

  test('bounds the dynamic layer and snaps the oldest visual to settled', () => {
    const state = new CompletedStitchVisualState();
    for (let index = 0; index < MAX_ACTIVE_COMPLETED_STITCHES; index++) {
      expect(state.place(index, 'local', 'readable', index, false)).toEqual([]);
    }

    expect(state.place(MAX_ACTIVE_COMPLETED_STITCHES, 'local', 'readable', 100, false)).toEqual([0]);
    expect(state.getActiveCellIndexes('readable')).toHaveLength(MAX_ACTIVE_COMPLETED_STITCHES);
    expect(state.get(0, true, 'readable', color, theme, 100).phase).toBe('settled');
  });

  test('undo at the dynamic layer bound snaps the oldest visual to settled', () => {
    const state = new CompletedStitchVisualState();
    for (let index = 0; index < MAX_ACTIVE_COMPLETED_STITCHES; index++) {
      expect(state.place(index, 'local', 'readable', index, false)).toEqual([]);
    }

    expect(state.undo(MAX_ACTIVE_COMPLETED_STITCHES, 100, false)).toEqual([0]);
    expect(state.getActiveCellIndexes('readable')).toHaveLength(MAX_ACTIVE_COMPLETED_STITCHES);
    expect(state.get(0, true, 'readable', color, theme, 100).phase).toBe('settled');
  });

  test('uses the three stable LOD decisions and preserves cross invariants across themes', () => {
    const state = new CompletedStitchVisualState();
    const near = state.get(1, true, 'readable', '#F8F7F0', theme, 0);
    const mid = state.get(1, true, 'mid', '#7C4A22', { finish: 'satin' }, 0);
    const far = state.get(1, true, 'out', '#101820', theme, 0);

    expect([near.representation, mid.representation, far.representation]).toEqual(['textured-cross', 'cross', 'mosaic']);
    for (const membershipTheme of MEMBERSHIP_THEMES) {
      const decision = state.get(1, true, 'readable', '#7C4A22', { finish: membershipTheme.threadFinish }, 0);
      expect(decision).toMatchObject({ geometry: 'two-strand-cross', lightDirection: 'upper-left', dmcColor: '#7C4A22' });
      expect(decision.strandOrder).toEqual(near.strandOrder);
    }
    expect(near.strandOrder).toEqual(mid.strandOrder);
    expect(mid.dmcColor).toBe('#7C4A22');
  });

  test('keeps very light, mid-tone, and very dark DMC colors recognizable under bounded depth treatment', () => {
    expect(deriveThreadSurfaceColors('#F8F7F0', 'matte')).toEqual({ base: '#F8F7F0', shadow: '#dfded8', highlight: '#f9f8f2' });
    expect(deriveThreadSurfaceColors('#7C4A22', 'satin')).toEqual({ base: '#7C4A22', shadow: '#683e1d', highlight: '#916745' });
    expect(deriveThreadSurfaceColors('#101820', 'matte')).toEqual({ base: '#101820', shadow: '#0e161d', highlight: '#282f36' });
  });
});
