import {
  LATENCY_MIN_SAMPLES,
  PERF_REPORT_SCHEMA_VERSION,
  REQUIRED_SCENARIOS,
  SCENARIO_KIND,
  STITCH_INTERACTION_BUDGET,
  isThermalWithinBudget,
  type ScenarioId,
  type ThermalState,
} from "./budgets";
import { type CriticalPathViolation } from "./criticalPathSentinel";
import { FrameSampler, percentile, type FrameSummary, ThermalSampler } from "./metrics";

/**
 * ADR-0031: Performance Report Evaluation and Formatting.
 */

export interface ScenarioMeasurement {
  scenarioId: ScenarioId;
  startedAtIso: string;
  durationMs: number;
  latencySamplesMs?: number[];
  frameIntervalsMs?: number[];
  thermalSamples?: ThermalState[];
  criticalPathViolations: CriticalPathViolation[];
  notes?: string;
}

export interface ScenarioResult {
  scenarioId: ScenarioId;
  passed: boolean;
  failures: string[];
  latency?: {
    p95Ms: number;
    sampleCount: number;
  };
  frames?: FrameSummary;
  thermal?: {
    worst: ThermalState;
  };
  durationMs: number;
}

export interface DeviceInfo {
  platform: "ios" | "android";
  osVersion: string;
  model: string;
  isReferenceDevice: boolean;
}

export interface PerfRunReport {
  schemaVersion: number;
  generatedAtIso: string;
  appVersion: string;
  gitSha?: string;
  device: DeviceInfo;
  fixture: {
    width: number;
    height: number;
    paletteSize: number;
    completedRatio: number;
  };
  results: ScenarioResult[];
  passed: boolean;
  failures: string[];
}

/**
 * Evaluates a single scenario measurement against ADR-0031 budget requirements.
 */
export function evaluateScenario(m: ScenarioMeasurement): ScenarioResult {
  const failures: string[] = [];

  // 1. Critical path violations check (affects all scenarios)
  if (m.criticalPathViolations.length > 0) {
    for (const v of m.criticalPathViolations) {
      failures.push(
        `${m.scenarioId}: critical path violation [${v.kind}]: ${v.detail} at ${v.atMs}ms`
      );
    }
  }

  const kind = SCENARIO_KIND[m.scenarioId];

  // Validate presence of required data
  if (kind === "latency" && m.latencySamplesMs === undefined) {
    failures.push(`${m.scenarioId}: latency samples are missing for latency scenario`);
  }
  if (kind === "frame-rate" && m.frameIntervalsMs === undefined) {
    failures.push(`${m.scenarioId}: frame intervals are missing for frame-rate scenario`);
  }
  if (kind === "sustained") {
    if (m.frameIntervalsMs === undefined) {
      failures.push(`${m.scenarioId}: frame intervals are missing for sustained scenario`);
    }
    if (m.thermalSamples === undefined) {
      failures.push(`${m.scenarioId}: thermal samples are missing for sustained scenario`);
    }
  }

  // 2. Evaluate latency
  let latencyRes: { p95Ms: number; sampleCount: number } | undefined;
  if (m.latencySamplesMs !== undefined) {
    const samples = m.latencySamplesMs;
    const minSamples =
      LATENCY_MIN_SAMPLES[m.scenarioId] ?? STITCH_INTERACTION_BUDGET.latency.minSamples;
    if (samples.length < minSamples) {
      failures.push(
        `${m.scenarioId}: sample count ${samples.length} is below minimum requirement of ${minSamples}`
      );
    }
    const p95 = samples.length > 0 ? percentile(samples, 0.95) : 0;
    if (samples.length > 0) {
      const limit = STITCH_INTERACTION_BUDGET.latency.p95MaxMs;
      if (p95 > limit) {
        failures.push(
          `${m.scenarioId}: p95 latency ${p95.toFixed(1)} ms exceeds ${limit} ms budget`
        );
      }
    }
    latencyRes = {
      p95Ms: p95,
      sampleCount: samples.length,
    };
  }

  // 3. Evaluate frame rate
  let framesRes: FrameSummary | undefined;
  if (m.frameIntervalsMs !== undefined) {
    const intervals = m.frameIntervalsMs;
    const minSamples = STITCH_INTERACTION_BUDGET.frameRate.minSamples;
    if (intervals.length < minSamples) {
      failures.push(
        `${m.scenarioId}: sample count ${intervals.length} is below minimum requirement of ${minSamples}`
      );
    }
    const sampler = new FrameSampler();
    for (const ms of intervals) {
      sampler.pushFrameInterval(ms);
    }
    const summary = sampler.summary();
    if (intervals.length > 0) {
      const budget = STITCH_INTERACTION_BUDGET.frameRate;
      if (summary.meanFps < budget.minMeanFps) {
        failures.push(
          `${m.scenarioId}: mean fps ${summary.meanFps.toFixed(1)} is below ${
            budget.minMeanFps
          } fps budget`
        );
      }
      if (summary.slowFrameRatio > budget.maxSlowFrameRatio) {
        failures.push(
          `${m.scenarioId}: ratio of slow frames ${(summary.slowFrameRatio * 100).toFixed(
            1
          )}% exceeds ${(budget.maxSlowFrameRatio * 100).toFixed(0)}% budget`
        );
      }
      if (summary.p99FrameMs > budget.p99MaxFrameMs) {
        failures.push(
          `${m.scenarioId}: p99 frame time ${summary.p99FrameMs.toFixed(1)} ms exceeds ${
            budget.p99MaxFrameMs
          } ms budget`
        );
      }
    }
    framesRes = summary;
  }

  // 4. Evaluate thermal & duration for sustained scenario
  let thermalRes: { worst: ThermalState } | undefined;
  if (m.thermalSamples !== undefined) {
    const thermals = m.thermalSamples;
    if (thermals.length === 0) {
      failures.push(`${m.scenarioId}: no thermal samples provided`);
    } else {
      const thermalSampler = new ThermalSampler();
      for (const t of thermals) {
        thermalSampler.push(t);
      }
      const worstState = thermalSampler.worst();
      if (worstState === "unsupported") {
        failures.push(
          `${m.scenarioId}: thermal state unavailable on this device; ADR-0031 requires heat to be measured on hardware`
        );
      } else if (!isThermalWithinBudget(worstState)) {
        failures.push(
          `${m.scenarioId}: worst thermal state "${worstState}" reached or exceeded "serious"`
        );
      }
      thermalRes = { worst: worstState };
    }
  }

  if (kind === "sustained") {
    const minDurationMs = STITCH_INTERACTION_BUDGET.sustained.minDurationMinutes * 60 * 1000;
    if (m.durationMs < minDurationMs) {
      failures.push(
        `${m.scenarioId}: duration ${m.durationMs} ms is below minimum requirement of ${minDurationMs} ms`
      );
    }
  }

  return {
    scenarioId: m.scenarioId,
    passed: failures.length === 0,
    failures,
    latency: latencyRes,
    frames: framesRes,
    thermal: thermalRes,
    durationMs: m.durationMs,
  };
}

/**
 * Validates and aggregates multiple ScenarioMeasurements into a PerfRunReport.
 */
export function buildRunReport(input: {
  appVersion: string;
  gitSha?: string;
  device: DeviceInfo;
  fixture: {
    width: number;
    height: number;
    paletteSize: number;
    completedRatio: number;
  };
  measurements: ScenarioMeasurement[];
  generatedAtIso?: string;
}): PerfRunReport {
  const results: ScenarioResult[] = [];
  const runFailures: string[] = [];

  // 1. Reference Device Verification
  if (!input.device.isReferenceDevice) {
    runFailures.push("Run failed: Device is not a designated reference device.");
  }

  // 2. Scenario Completeness Verification
  const presentIds = new Set(input.measurements.map((m) => m.scenarioId));
  for (const requiredId of REQUIRED_SCENARIOS) {
    if (!presentIds.has(requiredId)) {
      runFailures.push(`Run failed: Missing required scenario measurement "${requiredId}".`);
    }
  }

  // 3. Evaluate each scenario
  for (const m of input.measurements) {
    const res = evaluateScenario(m);
    results.push(res);
    if (!res.passed) {
      for (const fail of res.failures) {
        runFailures.push(fail);
      }
    }
  }

  const passed = runFailures.length === 0;

  return {
    schemaVersion: PERF_REPORT_SCHEMA_VERSION,
    generatedAtIso: input.generatedAtIso ?? new Date().toISOString(),
    appVersion: input.appVersion,
    gitSha: input.gitSha,
    device: input.device,
    fixture: input.fixture,
    results,
    passed,
    failures: runFailures,
  };
}

/**
 * Formats a PerfRunReport into an aligned ASCII plain-text table.
 */
export function formatRunReport(report: PerfRunReport): string {
  const lines: string[] = [];
  lines.push("================================================================================");
  lines.push("STITCH INTERACTION BUDGET PERFORMANCE REPORT (ADR-0031)");
  lines.push("================================================================================");
  lines.push(`Generated At: ${report.generatedAtIso}`);
  lines.push(`App Version:  ${report.appVersion}${report.gitSha ? ` (git: ${report.gitSha})` : ""}`);
  lines.push(
    `Device:       ${report.device.model} (${report.device.platform} ${
      report.device.osVersion
    }) [${report.device.isReferenceDevice ? "REFERENCE" : "NON-REFERENCE"}]`
  );
  lines.push(
    `Fixture:      ${report.fixture.width}x${report.fixture.height} pattern, ${
      report.fixture.paletteSize
    } colors, ${(report.fixture.completedRatio * 100).toFixed(0)}% completed`
  );
  lines.push("--------------------------------------------------------------------------------");
  lines.push("SCENARIO                                 KIND         DURATION     STATUS");
  lines.push("--------------------------------------------------------------------------------");

  for (const res of report.results) {
    const name = res.scenarioId.padEnd(40);
    const kind = (SCENARIO_KIND[res.scenarioId] || "").padEnd(12);
    const duration = `${res.durationMs} ms`.padEnd(13);
    const status = res.passed ? "PASS" : "FAIL";
    lines.push(`${name} ${kind} ${duration} ${status}`);
  }

  lines.push("--------------------------------------------------------------------------------");

  if (report.failures.length > 0) {
    lines.push("FAILURE DETAILS:");
    for (const fail of report.failures) {
      lines.push(`- ${fail}`);
    }
    lines.push("--------------------------------------------------------------------------------");
  }

  const resultStatus = report.passed ? "PASS" : "FAIL";
  lines.push(`RELEASE GATE: ${resultStatus}`);
  lines.push("================================================================================");

  return lines.join("\n");
}
