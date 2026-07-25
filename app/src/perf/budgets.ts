/**
 * ADR-0031: Stitch Interaction Budget
 * This file defines the performance report schema version, Scenario IDs,
 * Scenario kinds, Thermal states, and the exact budgets/thresholds required
 * for the cross-stitch game's release gate.
 */

export const PERF_REPORT_SCHEMA_VERSION = 1;

/**
 * Valid scenario IDs defined in ADR-0031.
 */
export type ScenarioId =
  | "stitch-latency"
  | "undo-latency"
  | "pan"
  | "anchored-zoom"
  | "stitch-sweep"
  | "worst-case-fully-completed"
  | "worst-case-rapid-stitch-during-pan-zoom"
  | "worst-case-memory-pressure"
  | "worst-case-gpu-context-loss"
  | "worst-case-app-resume"
  | "sustained-15min";

/**
 * List of all mandatory scenarios for a valid performance run.
 */
export const REQUIRED_SCENARIOS: readonly ScenarioId[] = [
  "stitch-latency",
  "undo-latency",
  "pan",
  "anchored-zoom",
  "stitch-sweep",
  "worst-case-fully-completed",
  "worst-case-rapid-stitch-during-pan-zoom",
  "worst-case-memory-pressure",
  "worst-case-gpu-context-loss",
  "worst-case-app-resume",
  "sustained-15min",
] as const;

export type ScenarioKind = "latency" | "frame-rate" | "sustained";

/**
 * Map of ScenarioId to its corresponding ScenarioKind.
 */
export const SCENARIO_KIND: Record<ScenarioId, ScenarioKind> = {
  "stitch-latency": "latency",
  "undo-latency": "latency",
  "worst-case-app-resume": "latency",
  "pan": "frame-rate",
  "anchored-zoom": "frame-rate",
  "stitch-sweep": "frame-rate",
  "worst-case-fully-completed": "frame-rate",
  "worst-case-rapid-stitch-during-pan-zoom": "frame-rate",
  "worst-case-memory-pressure": "frame-rate",
  "worst-case-gpu-context-loss": "frame-rate",
  "sustained-15min": "sustained",
} as const;

export type ThermalState = "nominal" | "fair" | "serious" | "critical" | "unsupported";

/**
 * Numeric severity mapping for ThermalState.
 * A higher value indicates a more severe thermal condition.
 * 'unsupported' is mapped to -1.
 */
export const THERMAL_SEVERITY: Record<ThermalState, number> = {
  unsupported: -1,
  nominal: 0,
  fair: 1,
  serious: 2,
  critical: 3,
};

/**
 * Helper to determine if a thermal state is within budget.
 * Under ADR-0031, it must stay strictly below 'serious' (i.e. 'nominal' or 'fair').
 * 'unsupported' is NOT within budget: ADR-0031 requires heat to be measured on
 * hardware rather than inferred, so a run that cannot read the platform thermal
 * state has not satisfied the requirement. The release gate CLI exposes an
 * explicit, loudly reported waiver for devices whose OS predates the thermal API
 * (Android below API 29); it never silently passes.
 */
export function isThermalWithinBudget(state: ThermalState): boolean {
  if (state === "unsupported") return false;
  return THERMAL_SEVERITY[state] < THERMAL_SEVERITY["serious"];
}

/**
 * Minimum latency sample counts per scenario. Stitch and Undo scenarios drive
 * hundreds of synthetic inputs; app resume is a coarse lifecycle event, so it
 * uses a lower but still statistically meaningful floor.
 */
export const LATENCY_MIN_SAMPLES: Partial<Record<ScenarioId, number>> = {
  "worst-case-app-resume": 10,
};

/**
 * Interaction budgets as specified in ADR-0031.
 */
export const STITCH_INTERACTION_BUDGET = {
  latency: {
    p95MaxMs: 50,
    minSamples: 100,
  },
  frameRate: {
    targetFps: 60,
    minMeanFps: 58,
    maxSlowFrameRatio: 0.05,
    slowFrameMs: 20,
    p99MaxFrameMs: 33,
    minSamples: 300,
  },
  sustained: {
    minDurationMinutes: 15,
    maxThermalState: "serious" as ThermalState, // must stay strictly below serious
  },
  criticalPath: {
    maxViolations: 0,
  },
  fixture: {
    width: 300,
    height: 300,
    paletteSize: 60,
    latePlayCompletedRatio: 0.85,
  },
} as const;

export interface ReferenceDeviceProfile {
  platform: "ios" | "android";
  label: string;
  minOsVersion: string;
}

/**
 * Reference device profiles derived from docs/app-metadata.md.
 */
export const REFERENCE_DEVICES: readonly ReferenceDeviceProfile[] = [
  {
    platform: "ios",
    label: "Oldest supported iOS reference device",
    minOsVersion: "16.4",
  },
  {
    platform: "android",
    label: "Oldest supported Android reference device",
    minOsVersion: "7.0",
  },
] as const;
