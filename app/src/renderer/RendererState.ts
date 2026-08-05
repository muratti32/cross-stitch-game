import { TILE_CELLS } from './tileMath';
import {
  CompletedStitchVisualState,
  type CompletedStitchVisualDecision,
} from './completedStitchVisualState';
import type { LodBand } from './tileMath';
import type { ThreadFinish } from '../membership/themes';

export class RendererState {
  public readonly width: number;
  public readonly height: number;
  public readonly tilesX: number;
  public readonly tilesY: number;

  // Compact state: 1 if completed, 0 if not
  private readonly completed: Uint8Array;

  // Dirty flags for tile pictures (1 if dirty, 0 if clean)
  private readonly completedDirty: Uint8Array;
  private readonly overlayDirty: Uint8Array;
  private readonly completedStitchVisuals = new CompletedStitchVisualState();

  // Remaining cell locator focus coordinates (-1 if none)
  private focusedCellX: number = -1;
  private focusedCellY: number = -1;

  constructor(width: number, height: number, initialCompleted?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.tilesX = Math.ceil(width / TILE_CELLS);
    this.tilesY = Math.ceil(height / TILE_CELLS);

    this.completed = initialCompleted && initialCompleted.length === width * height
      ? new Uint8Array(initialCompleted)
      : new Uint8Array(width * height);
    this.completedDirty = new Uint8Array(this.tilesX * this.tilesY);
    this.overlayDirty = new Uint8Array(this.tilesX * this.tilesY);

    // Initial state is all dirty so they record on first render
    this.completedDirty.fill(1);
    this.overlayDirty.fill(1);
  }

  /**
   * Returns the underlying completed array (read-only or clone for mutation).
   */
  public getCompletedArray(): Uint8Array {
    return this.completed;
  }

  /**
   * Restores the completed array from an existing buffer and dirties all tiles.
   */
  public restoreCompletedArray(array: Uint8Array): void {
    if (array.length === this.completed.length) {
      this.completed.set(array);
      // Restored progress is intentionally settled: reopening a session must
      // not flood the dynamic layer with historical animations.
      this.completedStitchVisuals.settleAll();
      this.completedDirty.fill(1);
      this.overlayDirty.fill(1);
    }
  }

  /**
   * Returns whether a cell has been completed.
   */
  public isCompleted(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    return this.completed[y * this.width + x] === 1;
  }

  /**
   * Sets the completion status of a cell.
   * If status changes, dirties the corresponding tile.
   * Returns true if status changed.
   */
  public setCompleted(x: number, y: number, isDone: boolean): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    const idx = y * this.width + x;
    const val = isDone ? 1 : 0;

    if (this.completed[idx] !== val) {
      this.completed[idx] = val;
      const tileX = Math.floor(x / TILE_CELLS);
      const tileY = Math.floor(y / TILE_CELLS);
      this.markTileDirty(tileX, tileY);
      return true;
    }
    return false;
  }

  /** Starts the visual feedback only after a local completed state committed. */
  public placeCompletedStitch(x: number, y: number, lod: LodBand, now: number, reduceMotion: boolean): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height || !this.isCompleted(x, y)) return;
    const snapped = this.completedStitchVisuals.place(y * this.width + x, 'local', lod, now, reduceMotion);
    this.markCompletedStitchTilesDirty(snapped);
  }

  /** Reverses visual feedback from its current visible progress after Undo commits. */
  public undoCompletedStitch(x: number, y: number, now: number, reduceMotion: boolean): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const snapped = this.completedStitchVisuals.undo(y * this.width + x, now, reduceMotion);
    this.markCompletedStitchTilesDirty(snapped);
  }

  /** Sync and restoration never impersonate a current-device player action. */
  public settleCompletedStitch(x: number, y: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const cellIndex = y * this.width + x;
    if (this.completedStitchVisuals.settle(cellIndex)) {
      this.markCompletedStitchTilesDirty([cellIndex]);
    }
  }

  public settleAllCompletedStitches(): void {
    this.markCompletedStitchTilesDirty(this.completedStitchVisuals.settleAll());
  }

  public isCompletedStitchDynamic(x: number, y: number, lod: LodBand): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height || lod === 'out') return false;
    return this.completedStitchVisuals.isDynamic(y * this.width + x, lod);
  }

  public getActiveCompletedStitchIndexes(lod: LodBand): readonly number[] {
    return this.completedStitchVisuals.getActiveCellIndexes(lod);
  }

  public getCompletedStitchVisualDecision(
    cellIndex: number,
    lod: LodBand,
    color: string,
    finish: ThreadFinish,
    now: number,
  ): CompletedStitchVisualDecision {
    return this.completedStitchVisuals.get(
      cellIndex,
      this.completed[cellIndex] === 1,
      lod,
      color,
      { finish },
      now,
    );
  }

  /** Advances only the small dynamic layer and re-dirties its settled tiles. */
  public advanceCompletedStitchVisuals(now: number): boolean {
    const transitioned = this.completedStitchVisuals.advance(now);
    this.markCompletedStitchTilesDirty(transitioned);
    return this.completedStitchVisuals.hasActiveVisuals;
  }

  public hasActiveCompletedStitchVisuals(): boolean {
    return this.completedStitchVisuals.hasActiveVisuals;
  }

  private markCompletedStitchTilesDirty(cellIndexes: readonly number[]): void {
    for (const index of cellIndexes) {
      const x = index % this.width;
      const y = Math.floor(index / this.width);
      this.markTileDirty(Math.floor(x / TILE_CELLS), Math.floor(y / TILE_CELLS));
    }
  }

  /**
   * Marks a tile as dirty for both completed and overlay layers.
   */
  public markTileDirty(tileX: number, tileY: number): void {
    if (tileX < 0 || tileX >= this.tilesX || tileY < 0 || tileY >= this.tilesY) return;
    const tileIdx = tileY * this.tilesX + tileX;
    this.completedDirty[tileIdx] = 1;
    this.overlayDirty[tileIdx] = 1;
  }

  /**
   * Marks all tiles dirty on the overlay layer (e.g. when selected color changes).
   */
  public markAllOverlayDirty(): void {
    this.overlayDirty.fill(1);
  }

  /**
   * Checks and clears the completed dirty flag for a tile.
   */
  public checkAndClearCompletedDirty(tileX: number, tileY: number): boolean {
    if (tileX < 0 || tileX >= this.tilesX || tileY < 0 || tileY >= this.tilesY) return false;
    const idx = tileY * this.tilesX + tileX;
    if (this.completedDirty[idx] === 1) {
      this.completedDirty[idx] = 0;
      return true;
    }
    return false;
  }

  /**
   * Checks and clears the overlay dirty flag for a tile.
   */
  public checkAndClearOverlayDirty(tileX: number, tileY: number): boolean {
    if (tileX < 0 || tileX >= this.tilesX || tileY < 0 || tileY >= this.tilesY) return false;
    const idx = tileY * this.tilesX + tileX;
    if (this.overlayDirty[idx] === 1) {
      this.overlayDirty[idx] = 0;
      return true;
    }
    return false;
  }

  /**
   * Sets focus to a specific cell, dirtying overlay for old and new focus tiles.
   */
  public focusCell(x: number, y: number): void {
    const oldX = this.focusedCellX;
    const oldY = this.focusedCellY;

    if (oldX === x && oldY === y) return;

    this.focusedCellX = x;
    this.focusedCellY = y;

    // Dirty the old focused tile
    if (oldX >= 0 && oldY >= 0) {
      const oldTileX = Math.floor(oldX / TILE_CELLS);
      const oldTileY = Math.floor(oldY / TILE_CELLS);
      this.overlayDirty[oldTileY * this.tilesX + oldTileX] = 1;
    }

    // Dirty the new focused tile
    if (x >= 0 && y >= 0) {
      const newTileX = Math.floor(x / TILE_CELLS);
      const newTileY = Math.floor(y / TILE_CELLS);
      this.overlayDirty[newTileY * this.tilesX + newTileX] = 1;
    }
  }

  /**
   * Returns current focus coordinates.
   */
  public getFocusedCell(): { x: number; y: number } {
    return { x: this.focusedCellX, y: this.focusedCellY };
  }
}
