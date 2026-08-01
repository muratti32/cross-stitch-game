import {
  CELL_SIZE,
  TILE_CELLS,
  TILE_SIZE,
  getTileCoords,
  getTileBounds,
  getVisibleTiles,
  getLodBand,
  getFitViewport,
  getAnchoredZoomTransform,
  nextRemainingCell,
  computeEdgePanVelocity,
} from '../tileMath';
import { RendererState } from '../RendererState';
import { TilePictureCache, TILE_CACHE_BUDGET } from '../pictureCache';
import type { SkPicture } from '@shopify/react-native-skia';

describe('Stitch Renderer Pure Logic', () => {
  describe('tileMath', () => {
    test('getTileCoords maps cells to 32x32 tiles correctly', () => {
      // Tile 0, 0
      expect(getTileCoords(0, 0)).toEqual({ tileX: 0, tileY: 0 });
      expect(getTileCoords(31, 31)).toEqual({ tileX: 0, tileY: 0 });

      // Tile boundaries
      expect(getTileCoords(32, 0)).toEqual({ tileX: 1, tileY: 0 });
      expect(getTileCoords(0, 32)).toEqual({ tileX: 0, tileY: 1 });
      expect(getTileCoords(32, 32)).toEqual({ tileX: 1, tileY: 1 });

      // Farther tiles
      expect(getTileCoords(65, 10)).toEqual({ tileX: 2, tileY: 0 });
    });

    test('getTileBounds calculates correct tile bounding box', () => {
      expect(getTileBounds(0, 0)).toEqual({
        left: 0,
        top: 0,
        right: TILE_SIZE,
        bottom: TILE_SIZE,
      });

      expect(getTileBounds(1, 2)).toEqual({
        left: TILE_SIZE,
        top: TILE_SIZE * 2,
        right: TILE_SIZE * 2,
        bottom: TILE_SIZE * 3,
      });
    });

    test('getVisibleTiles computes correct culled tiles and clamps to bounds', () => {
      // 100x100 pattern (approx 4x4 tiles of 32 cells each)
      const patternWidth = 100;
      const patternHeight = 100;

      // Viewport matching first tile perfectly, no offsets
      const viewport = {
        translateX: 0,
        translateY: 0,
        scale: 1.0,
        width: TILE_SIZE,
        height: TILE_SIZE,
      };

      // With prefetchMargin = 0
      let visible = getVisibleTiles(viewport, patternWidth, patternHeight, 0);
      expect(visible).toEqual([{ tileX: 0, tileY: 0 }]);

      // With prefetchMargin = 1, should include neighbors up to clamped boundaries
      visible = getVisibleTiles(viewport, patternWidth, patternHeight, 1);
      const expected = [
        { tileX: 0, tileY: 0 },
        { tileX: 1, tileY: 0 },
        { tileX: 0, tileY: 1 },
        { tileX: 1, tileY: 1 },
      ];
      expect(visible).toEqual(expect.arrayContaining(expected));
      expect(visible.length).toBe(4);
    });

    test('getLodBand returns correct bands based on cell screen size', () => {
      // cell screen size = scale * CELL_SIZE (CELL_SIZE = 16)
      // scale = 0.3 => cell screen size = 4.8px (<6px => 'out')
      expect(getLodBand(0.3)).toBe('out');

      // scale = 0.5 => cell screen size = 8.0px (6px - 14px => 'mid')
      expect(getLodBand(0.5)).toBe('mid');

      // scale = 1.0 => cell screen size = 16.0px (>14px => 'readable')
      expect(getLodBand(1.0)).toBe('readable');
    });

    test('getFitViewport calculates centered fitting transform correctly', () => {
      // 100x100 pattern. Content size = 100 * 16 = 1600px
      const patternWidth = 100;
      const patternHeight = 100;

      // Viewport size is 800x400. Fit scale should be 400 / 1600 = 0.25
      const fit = getFitViewport(patternWidth, patternHeight, 800, 400);
      expect(fit.scale).toBe(0.25);

      // Centered: translateX should be (800 - 1600 * 0.25) / 2 = 200
      expect(fit.translateX).toBe(200);
      // translateY should be (400 - 1600 * 0.25) / 2 = 0
      expect(fit.translateY).toBe(0);
    });

    test('getAnchoredZoomTransform keeps the anchor screen position fixed', () => {
      const currentScale = 1.0;
      const currentTx = -100;
      const currentTy = -100;
      const targetScale = 2.0;

      // Anchor point on screen
      const anchorScreenX = 400;
      const anchorScreenY = 300;

      const patternWidth = 100;
      const patternHeight = 100;
      const viewWidth = 800;
      const viewHeight = 600;

      const transform = getAnchoredZoomTransform(
        currentScale,
        currentTx,
        currentTy,
        targetScale,
        anchorScreenX,
        anchorScreenY,
        0.1,
        3.0,
        patternWidth,
        patternHeight,
        viewWidth,
        viewHeight
      );

      expect(transform.scale).toBe(2.0);

      // Verification: the anchor point's mapped pattern coordinate should yield the same screen coordinate after transformation
      // pattern_pos = (anchor_screen - current_t) / current_scale
      const patX = (anchorScreenX - currentTx) / currentScale; // (400 - (-100)) / 1 = 500
      const patY = (anchorScreenY - currentTy) / currentScale; // (300 - (-100)) / 1 = 400

      // new_screen = pattern_pos * target_scale + new_t
      const newScreenX = patX * transform.scale + transform.translateX;
      const newScreenY = patY * transform.scale + transform.translateY;

      expect(newScreenX).toBeCloseTo(anchorScreenX);
      expect(newScreenY).toBeCloseTo(anchorScreenY);
    });
  });

  describe('RendererState', () => {
    test('completing a cell dirties exactly its tile', () => {
      const state = new RendererState(100, 100);

      // Start all clean (construct marks dirty, so we clear them first)
      for (let ty = 0; ty < state.tilesY; ty++) {
        for (let tx = 0; tx < state.tilesX; tx++) {
          state.checkAndClearCompletedDirty(tx, ty);
          state.checkAndClearOverlayDirty(tx, ty);
        }
      }

      // Complete cell (35, 10) -> lies in tileX = 1, tileY = 0
      state.setCompleted(35, 10, true);

      // Verify that tile (1, 0) is dirty and others are clean
      for (let ty = 0; ty < state.tilesY; ty++) {
        for (let tx = 0; tx < state.tilesX; tx++) {
          const isCompletedDirty = state.checkAndClearCompletedDirty(tx, ty);
          const isOverlayDirty = state.checkAndClearOverlayDirty(tx, ty);

          if (tx === 1 && ty === 0) {
            expect(isCompletedDirty).toBe(true);
            expect(isOverlayDirty).toBe(true);
          } else {
            expect(isCompletedDirty).toBe(false);
            expect(isOverlayDirty).toBe(false);
          }
        }
      }
    });

    test('focusCell dirties old and new focus tiles in overlay only', () => {
      const state = new RendererState(100, 100);

      // Clear initial constructor dirties
      for (let ty = 0; ty < state.tilesY; ty++) {
        for (let tx = 0; tx < state.tilesX; tx++) {
          state.checkAndClearCompletedDirty(tx, ty);
          state.checkAndClearOverlayDirty(tx, ty);
        }
      }

      // Focus cell in tile (0, 0)
      state.focusCell(5, 5);

      // Focus cell in tile (1, 1) -> cell (35, 35)
      state.focusCell(35, 35);

      // Verify old focus tile (0, 0) and new focus tile (1, 1) are dirty in overlay
      expect(state.checkAndClearOverlayDirty(0, 0)).toBe(true);
      expect(state.checkAndClearOverlayDirty(1, 1)).toBe(true);

      // Completed dirty flags should remain unchanged (clean)
      expect(state.checkAndClearCompletedDirty(0, 0)).toBe(false);
      expect(state.checkAndClearCompletedDirty(1, 1)).toBe(false);
    });
  });

  describe('Stitch Sweep cell eligibility', () => {
    test('matching color and unfinished cell is eligible', () => {
      const grid = new Uint8Array([1, 1, 2, 2, 0, 1]);
      const completed = new Uint8Array([0, 1, 0, 1, 0, 0]);

      const isEligible = (cellX: number, cellY: number, activeColor: number, width: number): boolean => {
        const idx = cellY * width + cellX;
        return grid[idx] === activeColor + 1 && completed[idx] === 0;
      };

      expect(isEligible(0, 0, 0, 3)).toBe(true); // color index 0, unfinished
      expect(isEligible(1, 0, 0, 3)).toBe(false); // color index 0, completed
      expect(isEligible(2, 0, 0, 3)).toBe(false); // color index 1, mismatch
      expect(isEligible(2, 0, 1, 3)).toBe(true); // color index 1, unfinished
      expect(isEligible(1, 1, 0, 3)).toBe(false); // empty color index 0
    });
  });

  describe('One-Op-Per-Cell sweep behavior', () => {
    test('drag tracking only processes distinct new cells', () => {
      const grid = new Uint8Array([1, 1, 1]);
      const completed = new Uint8Array([0, 0, 0]);
      const mockProcessed: { x: number; y: number }[] = [];

      let lX = -1;
      let lY = -1;

      const simulateSweepMove = (x: number, y: number) => {
        if (lX !== x || lY !== y) {
          const idx = y * 3 + x;
          const matchesColor = grid[idx] === 1;
          const isUnfinished = completed[idx] === 0;

          if (matchesColor && isUnfinished) {
            completed[idx] = 1;
            lX = x;
            lY = y;
            mockProcessed.push({ x, y });
          }
        }
      };

      simulateSweepMove(0, 0);
      simulateSweepMove(0, 0);
      simulateSweepMove(1, 0);
      simulateSweepMove(0, 0); // backtrack should be ignored
      simulateSweepMove(2, 0);

      expect(mockProcessed).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]);
    });
  });

  describe('Remaining Cell Locator cycling order', () => {
    test('deterministic row-major cycle, skips completed, wraps', () => {
      const grid = new Uint8Array([1, 2, 1, 1, 2, 1]);
      const completed = new Uint8Array([0, 0, 1, 0, 0, 0]);
      const width = 3;
      const height = 2;
      const activeColor = 0; // value 1 in grid

      let located = nextRemainingCell(grid, completed, width, height, activeColor, -1);
      expect(located).toBe(0);

      located = nextRemainingCell(grid, completed, width, height, activeColor, 0);
      expect(located).toBe(3); // index 2 is completed, so it is skipped

      located = nextRemainingCell(grid, completed, width, height, activeColor, 3);
      expect(located).toBe(5);

      located = nextRemainingCell(grid, completed, width, height, activeColor, 5);
      expect(located).toBe(0); // wraps around

      located = nextRemainingCell(grid, completed, width, height, 5, -1);
      expect(located).toBeNull(); // empty color -> null
    });
  });

  describe('Edge Auto-Pan vector math', () => {
    test('calculates correct velocity based on proximity to edges', () => {
      const containerSize = 400;
      const margin = 48;
      const maxSpeed = 10;

      // Far from edges
      expect(computeEdgePanVelocity(200, containerSize, margin, maxSpeed)).toBe(0);

      // Proximity left
      expect(computeEdgePanVelocity(24, containerSize, margin, maxSpeed)).toBe(5);

      // At edge 0
      expect(computeEdgePanVelocity(0, containerSize, margin, maxSpeed)).toBe(maxSpeed);

      // Past edge 0
      expect(computeEdgePanVelocity(-10, containerSize, margin, maxSpeed)).toBe(maxSpeed);

      // Proximity right
      expect(computeEdgePanVelocity(376, containerSize, margin, maxSpeed)).toBeCloseTo(-5.0);

      // Exactly at edge right
      expect(computeEdgePanVelocity(400, containerSize, margin, maxSpeed)).toBe(-maxSpeed);
    });
  });

  describe('Handedness preference mapping', () => {
    test('correctly maps handedness string to layout style settings', () => {
      const getLayoutForHandedness = (handedness: 'left' | 'right') => {
        return {
          flexDirection: handedness === 'left' ? 'row' : 'row-reverse',
          justifyContent: handedness === 'left' ? 'flex-start' : 'flex-end',
          railSide: handedness === 'left' ? 'left' : 'right',
        };
      };

      expect(getLayoutForHandedness('left')).toEqual({
        flexDirection: 'row',
        justifyContent: 'flex-start',
        railSide: 'left',
      });

      expect(getLayoutForHandedness('right')).toEqual({
        flexDirection: 'row-reverse',
        justifyContent: 'flex-end',
        railSide: 'right',
      });
    });
  });

  describe('TilePictureCache (LRU)', () => {
    const pic = (id: number) => ({ id } as unknown as SkPicture);

    test('get refreshes recency so prune evicts least recently used first', () => {
      const cache = new TilePictureCache();
      cache.set('0_0', pic(1));
      cache.set('1_0', pic(2));
      cache.set('2_0', pic(3));

      // Touch the oldest entry so it becomes most recently used
      cache.get('0_0');

      cache.prune(new Set<string>(), 2);

      expect(cache.size).toBe(2);
      expect(cache.get('1_0')).toBeUndefined(); // LRU evicted
      expect(cache.get('0_0')).toBeDefined();
      expect(cache.get('2_0')).toBeDefined();
    });

    test('prune never evicts protected (visible) keys', () => {
      const cache = new TilePictureCache();
      cache.set('0_0', pic(1));
      cache.set('1_0', pic(2));
      cache.set('2_0', pic(3));

      cache.prune(new Set(['0_0', '1_0', '2_0']), 1);

      // All keys protected: budget cannot be met, nothing evicted
      expect(cache.size).toBe(3);
    });

    test('prune is a no-op when within budget', () => {
      const cache = new TilePictureCache();
      cache.set('0_0', pic(1));
      cache.prune(new Set<string>(), TILE_CACHE_BUDGET);
      expect(cache.size).toBe(1);
    });

    test('set replaces existing key without growing the cache', () => {
      const cache = new TilePictureCache();
      cache.set('0_0', pic(1));
      cache.set('0_0', pic(2));
      expect(cache.size).toBe(1);
      expect((cache.get('0_0') as unknown as { id: number }).id).toBe(2);
    });

    test('delete removes a cached picture without affecting other keys', () => {
      const cache = new TilePictureCache();
      cache.set('0_0_shape', pic(1));
      cache.set('0_0_mosaic', pic(2));

      cache.delete('0_0_shape');

      expect(cache.get('0_0_shape')).toBeUndefined();
      expect(cache.get('0_0_mosaic')).toBeDefined();
      expect(cache.size).toBe(1);
    });
  });
});
