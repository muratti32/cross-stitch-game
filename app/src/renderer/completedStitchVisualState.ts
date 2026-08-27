import { THREAD_WIDTH_PLAIN, THREAD_WIDTH_TEXTURED, type LodBand } from './tileMath';
import type { ThreadFinish } from '../membership/themes';

export type CompletedStitchOrigin = 'local' | 'restored' | 'synchronized';
export type CompletedStitchPhase = 'placing' | 'removing' | 'settled' | 'hidden';
export type CompletedStitchRepresentation = 'textured-cross' | 'cross' | 'mosaic' | 'none';
export interface CompletedStitchThemeTreatment {
  readonly finish: ThreadFinish;
}

/**
 * Base stroke width for one strand of a Completed Stitch. A textured cross
 * carries the heavier thread; every other cross representation uses the plain
 * width. Both render layers must ask here so they cannot disagree.
 */
export function getThreadWidth(representation: CompletedStitchRepresentation): number {
  return representation === 'textured-cross' ? THREAD_WIDTH_TEXTURED : THREAD_WIDTH_PLAIN;
}

export interface ThreadSurfaceColors {
  readonly base: string;
  readonly shadow: string;
  readonly highlight: string;
}

function adjustRgb(hex: string, towardWhite: boolean, amount: number): string {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hex;
  const channel = (offset: number) => parseInt(normalized.slice(offset, offset + 2), 16);
  const adjust = (value: number) => Math.round(value + ((towardWhite ? 255 : 0) - value) * amount)
    .toString(16).padStart(2, '0');
  return `#${adjust(channel(0))}${adjust(channel(2))}${adjust(channel(4))}`;
}

/** Fixed, bounded depth treatment; it never substitutes the DMC base color. */
export function deriveThreadSurfaceColors(dmcColor: string, finish: ThreadFinish): ThreadSurfaceColors {
  const amount = finish === 'satin' ? 0.16 : 0.10;
  return {
    base: dmcColor,
    shadow: adjustRgb(dmcColor, false, amount),
    highlight: adjustRgb(dmcColor, true, amount),
  };
}

export interface CompletedStitchVisualDecision {
  readonly phase: CompletedStitchPhase;
  readonly progress: number;
  readonly lowerStrandProgress: number;
  readonly upperStrandProgress: number;
  readonly representation: CompletedStitchRepresentation;
  readonly showThreadNumber: boolean;
  readonly geometry: 'two-strand-cross';
  readonly strandOrder: readonly ['lower-left-to-upper-right', 'upper-left-to-lower-right'];
  readonly lightDirection: 'upper-left';
  readonly dmcColor: string;
  readonly finish: ThreadFinish;
  readonly isDynamic: boolean;
}

interface ActiveVisual {
  phase: 'placing' | 'removing';
  startedAt: number;
  initialProgress: number;
}

const PLACEMENT_DURATION_MS = 140;
const REMOVAL_DURATION_MS = 110;
export const MAX_ACTIVE_COMPLETED_STITCHES = 48;
const STRAND_ORDER = ['lower-left-to-upper-right', 'upper-left-to-lower-right'] as const;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function representationFor(lod: LodBand): CompletedStitchRepresentation {
  if (lod === 'out') return 'mosaic';
  return lod === 'mid' ? 'cross' : 'textured-cross';
}

/**
 * Deterministic, platform-independent visual state for Completed Stitches.
 * It deliberately contains no Skia calls so renderer tests observe player
 * facing decisions instead of implementation-specific draw commands.
 */
export class CompletedStitchVisualState {
  private readonly active = new Map<number, ActiveVisual>();

  place(cellIndex: number, origin: CompletedStitchOrigin, lod: LodBand, now: number, reduceMotion: boolean): readonly number[] {
    if (origin !== 'local' || lod === 'out' || reduceMotion) {
      this.active.delete(cellIndex);
      return [];
    }

    const current = this.active.get(cellIndex);
    if (current?.phase === 'placing') {
      return [];
    }

    if (current?.phase === 'removing') {
      this.active.set(cellIndex, {
        phase: 'placing',
        startedAt: now,
        initialProgress: this.progressAt(current, now),
      });
      return [];
    }

    const snapped: number[] = [];
    if (!this.active.has(cellIndex) && this.active.size >= MAX_ACTIVE_COMPLETED_STITCHES) {
      const oldest = this.active.keys().next().value;
      if (oldest !== undefined) {
        this.active.delete(oldest);
        snapped.push(oldest);
      }
    }
    this.active.set(cellIndex, { phase: 'placing', startedAt: now, initialProgress: 0 });
    return snapped;
  }

  undo(cellIndex: number, now: number, reduceMotion: boolean): readonly number[] {
    if (reduceMotion) {
      this.active.delete(cellIndex);
      return [];
    }
    const current = this.active.get(cellIndex);
    const visibleProgress = current ? this.progressAt(current, now) : 1;
    if (visibleProgress <= 0) {
      this.active.delete(cellIndex);
      return [];
    }
    const snapped: number[] = [];
    if (!current && this.active.size >= MAX_ACTIVE_COMPLETED_STITCHES) {
      const oldest = this.active.keys().next().value;
      if (oldest !== undefined) {
        this.active.delete(oldest);
        snapped.push(oldest);
      }
    }
    this.active.set(cellIndex, {
      phase: 'removing',
      startedAt: now,
      initialProgress: visibleProgress,
    });
    return snapped;
  }

  settle(cellIndex: number): boolean {
    return this.active.delete(cellIndex);
  }

  settleAll(): readonly number[] {
    const settled = [...this.active.keys()];
    this.active.clear();
    return settled;
  }

  get(cellIndex: number, completed: boolean, lod: LodBand, color: string, theme: CompletedStitchThemeTreatment, now: number): CompletedStitchVisualDecision {
    const active = this.active.get(cellIndex);
    const progress = active ? this.progressAt(active, now) : completed ? 1 : 0;
    const phase: CompletedStitchPhase = active
      ? active.phase
      : completed ? 'settled' : 'hidden';
    const visible = progress > 0;
    const lowerStrandProgress = clamp(progress * 2);
    const upperStrandProgress = clamp(progress * 2 - 1);
    // The renderer receives the chosen representation at placement start so
    // its first dynamic-frame work is not delayed until a later state change.
    const representation = (visible || active !== undefined) ? representationFor(lod) : 'none';

    return {
      phase,
      progress,
      lowerStrandProgress,
      upperStrandProgress,
      representation,
      // A cell that is visibly unthreading stays visually complete until the
      // final strand is gone, avoiding a number painted through thread.
      showThreadNumber: !completed && active === undefined,
      geometry: 'two-strand-cross',
      strandOrder: STRAND_ORDER,
      lightDirection: 'upper-left',
      dmcColor: color,
      finish: theme.finish,
      isDynamic: active !== undefined && lod !== 'out',
    };
  }

  getActiveCellIndexes(lod: LodBand): readonly number[] {
    if (lod === 'out') return [];
    return [...this.active.keys()];
  }

  isDynamic(cellIndex: number, lod: LodBand): boolean {
    if (lod === 'out') return false;
    const visual = this.active.get(cellIndex);
    // Keep a just-started placement out of the recorded tile even when its
    // first frame has progress 0; the next frame grows it from the center.
    return visual !== undefined;
  }

  advance(now: number): readonly number[] {
    const settled: number[] = [];
    for (const [cellIndex, visual] of this.active) {
      const progress = this.progressAt(visual, now);
      if ((visual.phase === 'placing' && progress >= 1) || (visual.phase === 'removing' && progress <= 0)) {
        this.active.delete(cellIndex);
        settled.push(cellIndex);
      }
    }
    return settled;
  }

  get hasActiveVisuals(): boolean {
    return this.active.size > 0;
  }

  private progressAt(visual: ActiveVisual, now: number): number {
    const elapsed = Math.max(0, now - visual.startedAt);
    if (visual.phase === 'placing') {
      return clamp(visual.initialProgress + (elapsed / PLACEMENT_DURATION_MS) * (1 - visual.initialProgress));
    }
    return clamp(visual.initialProgress * (1 - elapsed / REMOVAL_DURATION_MS));
  }
}
