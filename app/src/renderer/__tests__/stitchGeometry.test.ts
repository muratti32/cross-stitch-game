import {
  CELL_SIZE,
  FABRIC_INSET,
  THREAD_HIGHLIGHT_WIDTH,
  THREAD_INSET,
  THREAD_SHADOW_DELTA,
  THREAD_WIDEST_STROKE,
  THREAD_WIDTH_PLAIN,
  THREAD_WIDTH_TEXTURED,
  getStitchGeometry,
  getThreadClearance,
} from '../tileMath';
import { getThreadWidth } from '../completedStitchVisualState';

describe('getStitchGeometry', () => {
  it('lands a fully drawn stitch exactly on the thread inset', () => {
    const g = getStitchGeometry();
    const near = THREAD_INSET;
    const far = CELL_SIZE - THREAD_INSET;

    expect(g.lowerStart).toEqual({ x: near, y: far });
    expect(g.lowerEnd).toEqual({ x: far, y: near });
    expect(g.upperStart).toEqual({ x: near, y: near });
    expect(g.upperEnd).toEqual({ x: far, y: far });
  });

  it('grows both strands outward from the cell center', () => {
    const center = CELL_SIZE / 2;
    const g = getStitchGeometry(0, 0);

    expect(g.lowerStart).toEqual({ x: center, y: center });
    expect(g.lowerEnd).toEqual({ x: center, y: center });
    expect(g.upperStart).toEqual({ x: center, y: center });
    expect(g.upperEnd).toEqual({ x: center, y: center });
  });

  it('advances each strand independently', () => {
    const g = getStitchGeometry(1, 0.5);

    expect(g.lowerStart.x).toBeCloseTo(THREAD_INSET, 6);
    expect(g.upperStart.x).toBeCloseTo(CELL_SIZE / 2 - (CELL_SIZE / 2 - THREAD_INSET) * 0.5, 6);
  });

  it('keeps the highlight on the upper strand, trimmed and shifted', () => {
    const g = getStitchGeometry();

    // Same direction as the upper strand.
    const strandDx = g.upperEnd.x - g.upperStart.x;
    const strandDy = g.upperEnd.y - g.upperStart.y;
    const hlDx = g.highlightEnd.x - g.highlightStart.x;
    const hlDy = g.highlightEnd.y - g.highlightStart.y;
    expect(hlDx / hlDy).toBeCloseTo(strandDx / strandDy, 6);

    // Shorter than the strand it rides.
    expect(Math.hypot(hlDx, hlDy)).toBeLessThan(Math.hypot(strandDx, strandDy));

    // Offset perpendicular, toward the top-right (lit) edge.
    expect(g.highlightStart.x).toBeGreaterThan(g.upperStart.x);
    expect(g.highlightEnd.y).toBeLessThan(g.upperEnd.y);
  });

  it('places the highlight where the cached tile path used to hardcode it', () => {
    // Guards the geometry the two render layers were reconciled onto.
    const g = getStitchGeometry();

    expect(g.highlightStart.x).toBeCloseTo(3.4, 1);
    expect(g.highlightStart.y).toBeCloseTo(3.0, 1);
    expect(g.highlightEnd.x).toBeCloseTo(CELL_SIZE - 3.0, 1);
    expect(g.highlightEnd.y).toBeCloseTo(CELL_SIZE - 3.4, 1);
  });
});

describe('getThreadWidth', () => {
  it('gives a textured cross the heavier thread', () => {
    expect(getThreadWidth('textured-cross')).toBe(THREAD_WIDTH_TEXTURED);
  });

  it('gives every other cross representation the plain thread', () => {
    expect(getThreadWidth('cross')).toBe(THREAD_WIDTH_PLAIN);
    expect(getThreadWidth('mosaic')).toBe(THREAD_WIDTH_PLAIN);
    expect(getThreadWidth('none')).toBe(THREAD_WIDTH_PLAIN);
  });
});

describe('getThreadClearance', () => {
  it('keeps the widest stroke inside the fabric rectangle', () => {
    expect(getThreadClearance()).toBeGreaterThan(0);
  });

  it('tracks the widest stroke actually drawn', () => {
    expect(THREAD_WIDEST_STROKE).toBe(THREAD_WIDTH_TEXTURED + THREAD_SHADOW_DELTA);
    expect(THREAD_WIDEST_STROKE).toBeGreaterThan(THREAD_WIDTH_PLAIN + THREAD_SHADOW_DELTA);
    expect(THREAD_WIDEST_STROKE).toBeGreaterThan(THREAD_HIGHLIGHT_WIDTH);
  });

  it('leaves the fabric rectangle inside the cell', () => {
    expect(FABRIC_INSET).toBeGreaterThan(0);
    expect(FABRIC_INSET).toBeLessThan(THREAD_INSET);
  });
});
