import { CompletedStitchVisualState } from '../completedStitchVisualState';
import { RendererState } from '../RendererState';

describe('Issue #248 - Pan Redraw and Tile Complexity ANR on Low-End Devices', () => {
  describe('Tile Picture Complexity Capping for device.class: low', () => {
    test('caps representation to plain cross (no textured-cross) on low-end devices at readable LOD', () => {
      const state = new CompletedStitchVisualState('low');
      const decision = state.get(
        0,
        true,
        'readable',
        '#123456',
        { finish: 'matte' },
        0,
      );

      // On low-end devices (≤3 GB RAM), tile picture complexity must be capped
      // to avoid nested SkPicture replay exceeding ANR budget.
      // Textured cross has 5 draw passes per cell (shadow + base lower + base upper + highlight + fabric).
      // Plain cross has 2 passes (no shadow, no highlight).
      expect(decision.representation).toBe('cross');
    });

    test('allows textured-cross on normal/high-end devices at readable LOD', () => {
      const state = new CompletedStitchVisualState('standard');
      const decision = state.get(
        0,
        true,
        'readable',
        '#123456',
        { finish: 'matte' },
        0,
      );

      expect(decision.representation).toBe('textured-cross');
    });

    test('RendererState propagates deviceClass to completedStitchVisuals', () => {
      const completed = new Uint8Array(100);
      completed[0] = 1;
      const lowEndRendererState = new RendererState(10, 10, completed, 'low');
      const decision = lowEndRendererState.getCompletedStitchVisualDecision(
        0,
        'readable',
        '#123456',
        'matte',
        0,
      );
      expect(decision.representation).toBe('cross');
    });
  });

  describe('Pan Redraw Coalescing (ADR-0056)', () => {
    // Import drainPanDeltas from tileMath
    const { drainPanDeltas, clampTranslation } = require('../tileMath');

    test('returns shouldUpdate: false when pending deltas are zero', () => {
      const result = drainPanDeltas(0, 0);
      expect(result).toEqual({ dx: 0, dy: 0, shouldUpdate: false });
    });

    test('accumulates consecutive high-frequency touch events and commits once on drain (VSYNC)', () => {
      let pendingDx = 0;
      let pendingDy = 0;
      let translateX = 100;
      let translateY = 100;

      // Simulate 4 touch move events arriving in a single 16.6ms frame (e.g. 240Hz touch sampling)
      const touchEvents = [
        { changeX: 1.5, changeY: -0.5 },
        { changeX: 2.0, changeY: -1.0 },
        { changeX: 1.0, changeY: 0.5 },
        { changeX: 3.5, changeY: -1.0 },
      ];

      for (const ev of touchEvents) {
        pendingDx += ev.changeX;
        pendingDy += ev.changeY;
      }

      // Prior to VSYNC frame tick, translations remain unchanged (preventing 4 synchronous Skia redraws)
      expect(translateX).toBe(100);
      expect(translateY).toBe(100);
      expect(pendingDx).toBeCloseTo(8.0);
      expect(pendingDy).toBeCloseTo(-2.0);

      // On VSYNC (useFrameCallback)
      const drain = drainPanDeltas(pendingDx, pendingDy);
      expect(drain.shouldUpdate).toBe(true);
      expect(drain.dx).toBeCloseTo(8.0);
      expect(drain.dy).toBeCloseTo(-2.0);

      translateX += drain.dx;
      translateY += drain.dy;
      pendingDx = 0;
      pendingDy = 0;

      expect(translateX).toBeCloseTo(108.0);
      expect(translateY).toBeCloseTo(98.0);

      // Subsequent frame with no new touches must not trigger update
      const idleDrain = drainPanDeltas(pendingDx, pendingDy);
      expect(idleDrain.shouldUpdate).toBe(false);
    });

    test('flushes pending deltas immediately on gesture boundary (pinch / pan release)', () => {
      let pendingDx = 5.0;
      let pendingDy = -3.0;
      let translateX = 50;
      let translateY = 50;

      // When user starts a pinch or releases finger, uncommitted deltas must flush immediately
      const flush = drainPanDeltas(pendingDx, pendingDy);
      if (flush.shouldUpdate) {
        pendingDx = 0;
        pendingDy = 0;
        translateX += flush.dx;
        translateY += flush.dy;
      }

      expect(pendingDx).toBe(0);
      expect(pendingDy).toBe(0);
      expect(translateX).toBe(55);
      expect(translateY).toBe(47);
    });
  });
});

