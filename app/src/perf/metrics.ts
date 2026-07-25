import { STITCH_INTERACTION_BUDGET, THERMAL_SEVERITY, type ThermalState } from "./budgets";

/**
 * ADR-0031: Pure performance metric math helpers and samplers.
 */

/**
 * Calculates the p-th percentile of an array of numbers using linear interpolation.
 * @param sortedOrUnsorted Array of numeric samples.
 * @param p Percentile threshold in range [0, 1].
 * @returns Interpolated percentile value.
 */
export function percentile(sortedOrUnsorted: readonly number[], p: number): number {
  if (sortedOrUnsorted.length === 0) {
    throw new Error("Percentile input array cannot be empty.");
  }
  if (p < 0 || p > 1) {
    throw new Error("Percentile p must be between 0 and 1 inclusive.");
  }
  const sorted = [...sortedOrUnsorted].sort((a, b) => a - b);
  const pos = p * (sorted.length - 1);
  const base = Math.floor(pos);
  const diff = pos - base;
  if (base + 1 < sorted.length) {
    return sorted[base] + diff * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Calculates the mean (average) of an array of numbers.
 * @param values Array of numeric samples.
 */
export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Mean input array cannot be empty.");
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

/**
 * LatencySampler tracks input-to-visible-state latency samples.
 * It pairs input events with their visible paint counterparts using a unique ID.
 */
export class LatencySampler {
  private inputs = new Map<string, number>();
  private completedSamples: number[] = [];

  markInput(id: string, atMs: number): void {
    this.inputs.set(id, atMs);
  }

  markVisible(id: string, atMs: number): void {
    const inputTime = this.inputs.get(id);
    if (inputTime !== undefined) {
      this.completedSamples.push(atMs - inputTime);
      this.inputs.delete(id);
    }
  }

  get pendingCount(): number {
    return this.inputs.size;
  }

  samples(): number[] {
    return [...this.completedSamples];
  }

  reset(): void {
    this.inputs.clear();
    this.completedSamples = [];
  }
}

export interface FrameSummary {
  frameCount: number;
  meanFrameMs: number;
  meanFps: number;
  p99FrameMs: number;
  slowFrameRatio: number;
}

/**
 * FrameSampler collects frame durations and computes summary statistics.
 * It ignores non-finite and zero/negative intervals.
 */
export class FrameSampler {
  private frameIntervals: number[] = [];

  pushFrameInterval(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) {
      return;
    }
    this.frameIntervals.push(ms);
  }

  intervals(): number[] {
    return [...this.frameIntervals];
  }

  summary(): FrameSummary {
    const length = this.frameIntervals.length;
    if (length === 0) {
      return {
        frameCount: 0,
        meanFrameMs: 0,
        meanFps: 0,
        p99FrameMs: 0,
        slowFrameRatio: 0,
      };
    }
    const avgMs = mean(this.frameIntervals);
    const fps = avgMs > 0 ? 1000 / avgMs : 0;
    const p99Ms = percentile(this.frameIntervals, 0.99);
    const slowLimit = STITCH_INTERACTION_BUDGET.frameRate.slowFrameMs;
    const slowCount = this.frameIntervals.filter((ms) => ms > slowLimit).length;
    const slowRatio = slowCount / length;

    return {
      frameCount: length,
      meanFrameMs: avgMs,
      meanFps: fps,
      p99FrameMs: p99Ms,
      slowFrameRatio: slowRatio,
    };
  }

  reset(): void {
    this.frameIntervals = [];
  }
}

/**
 * ThermalSampler tracks device thermal state progression.
 */
export class ThermalSampler {
  private thermalStates: ThermalState[] = [];

  push(state: ThermalState): void {
    this.thermalStates.push(state);
  }

  samples(): ThermalState[] {
    return [...this.thermalStates];
  }

  worst(): ThermalState {
    if (this.thermalStates.length === 0) {
      throw new Error("ThermalSampler is empty.");
    }
    // 'unsupported' never counts as worst unless it is the only value observed.
    const supported = this.thermalStates.filter((s) => s !== "unsupported");
    if (supported.length === 0) {
      return "unsupported";
    }
    let worstState = supported[0];
    let maxSeverity = THERMAL_SEVERITY[worstState];
    for (let i = 1; i < supported.length; i++) {
      const current = supported[i];
      const severity = THERMAL_SEVERITY[current];
      if (severity > maxSeverity) {
        maxSeverity = severity;
        worstState = current;
      }
    }
    return worstState;
  }

  reset(): void {
    this.thermalStates = [];
  }
}
