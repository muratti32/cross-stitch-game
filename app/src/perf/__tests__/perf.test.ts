import {
  STITCH_INTERACTION_BUDGET,
  REQUIRED_SCENARIOS,
  type ScenarioId,
  type ThermalState,
} from "../budgets";
import {
  percentile,
  mean,
  LatencySampler,
  FrameSampler,
  ThermalSampler,
} from "../metrics";
import {
  buildBudgetPalette,
  buildBudgetPattern,
  buildCompletedMask,
  buildLatePlayFixture,
  buildFullyCompletedFixture,
} from "../fixtures";
import {
  beginCriticalPathWindow,
  endCriticalPathWindow,
  markCriticalPathActivity,
  isCriticalPathWindowOpen,
  resetCriticalPathSentinel,
  setCriticalPathClock,
  type CriticalPathViolation,
} from "../criticalPathSentinel";
import {
  evaluateScenario,
  buildRunReport,
  formatRunReport,
  type ScenarioMeasurement,
} from "../report";

describe("Performance Measurement Core (ADR-0031)", () => {
  beforeEach(() => {
    resetCriticalPathSentinel();
  });

  describe("percentile and mean math helpers", () => {
    test("percentile calculates linear interpolation correctly", () => {
      // Median of [10, 20] is 15
      expect(percentile([10, 20], 0.5)).toBe(15);
      expect(percentile([20, 10], 0.5)).toBe(15); // Unsorted

      // 90th percentile of [10, 20, 30]
      // pos = 0.9 * 2 = 1.8 -> base = 1, diff = 0.8
      // val = 20 + 0.8 * (30 - 20) = 28
      expect(percentile([10, 20, 30], 0.9)).toBe(28);

      // Edge cases
      expect(percentile([5], 0.5)).toBe(5);
      expect(percentile([5], 0.99)).toBe(5);
      expect(percentile([10, 20], 0)).toBe(10);
      expect(percentile([10, 20], 1)).toBe(20);
    });

    test("percentile validates inputs", () => {
      expect(() => percentile([], 0.5)).toThrow("empty");
      expect(() => percentile([1, 2], -0.1)).toThrow("between 0 and 1");
      expect(() => percentile([1, 2], 1.1)).toThrow("between 0 and 1");
    });

    test("mean calculates averages correctly", () => {
      expect(mean([1, 2, 3, 4])).toBe(2.5);
      expect(mean([10])).toBe(10);
      expect(() => mean([])).toThrow("empty");
    });
  });

  describe("LatencySampler", () => {
    test("pairs input and visible timestamps and reports pending count", () => {
      const sampler = new LatencySampler();
      expect(sampler.pendingCount).toBe(0);

      sampler.markInput("action-1", 100);
      expect(sampler.pendingCount).toBe(1);

      sampler.markInput("action-2", 105);
      expect(sampler.pendingCount).toBe(2);

      // Unmatched visible mark is ignored
      sampler.markVisible("action-99", 110);
      expect(sampler.pendingCount).toBe(2);
      expect(sampler.samples()).toEqual([]);

      sampler.markVisible("action-1", 112);
      expect(sampler.pendingCount).toBe(1);
      expect(sampler.samples()).toEqual([12]); // 112 - 100

      sampler.markVisible("action-2", 130);
      expect(sampler.pendingCount).toBe(0);
      expect(sampler.samples()).toEqual([12, 25]); // 130 - 105

      sampler.reset();
      expect(sampler.pendingCount).toBe(0);
      expect(sampler.samples()).toEqual([]);
    });
  });

  describe("FrameSampler", () => {
    test("ignores non-finite and <= 0 intervals", () => {
      const sampler = new FrameSampler();
      sampler.pushFrameInterval(16.6);
      sampler.pushFrameInterval(-5);
      sampler.pushFrameInterval(0);
      sampler.pushFrameInterval(Infinity);
      sampler.pushFrameInterval(NaN);
      sampler.pushFrameInterval(16.8);

      expect(sampler.intervals()).toEqual([16.6, 16.8]);
    });

    test("computes frame summary statistics correctly", () => {
      const sampler = new FrameSampler();
      // Total 10 frames: 8 frames of 16 ms (62.5 fps), 2 frames of 25 ms (slow > 20ms)
      for (let i = 0; i < 8; i++) sampler.pushFrameInterval(16);
      sampler.pushFrameInterval(25);
      sampler.pushFrameInterval(25);

      const summary = sampler.summary();
      expect(summary.frameCount).toBe(10);
      expect(summary.meanFrameMs).toBe(17.8);
      expect(summary.meanFps).toBeCloseTo(1000 / 17.8, 4);
      expect(summary.slowFrameRatio).toBe(0.2); // 2 / 10
      expect(summary.p99FrameMs).toBe(25);
    });

    test("returns zero summary when empty", () => {
      const sampler = new FrameSampler();
      expect(sampler.summary()).toEqual({
        frameCount: 0,
        meanFrameMs: 0,
        meanFps: 0,
        p99FrameMs: 0,
        slowFrameRatio: 0,
      });
    });
  });

  describe("ThermalSampler", () => {
    test("determines the worst state favoring actual reports over unsupported", () => {
      const sampler = new ThermalSampler();
      expect(() => sampler.worst()).toThrow("empty");

      sampler.push("unsupported");
      expect(sampler.worst()).toBe("unsupported");

      sampler.push("nominal");
      expect(sampler.worst()).toBe("nominal");

      sampler.push("fair");
      expect(sampler.worst()).toBe("fair");

      sampler.push("unsupported");
      expect(sampler.worst()).toBe("fair");

      sampler.push("serious");
      expect(sampler.worst()).toBe("serious");

      sampler.push("critical");
      expect(sampler.worst()).toBe("critical");
    });
  });

  describe("CriticalPathSentinel", () => {
    test("prevents nested windows and monitors activity", () => {
      beginCriticalPathWindow("test-win");
      expect(isCriticalPathWindowOpen()).toBe(true);

      expect(() => beginCriticalPathWindow("nested")).toThrow("already open");

      // Inject mock clock
      let mockTime = 1000;
      setCriticalPathClock(() => mockTime);

      markCriticalPathActivity("network", "fetching sync status");
      mockTime = 1050;
      markCriticalPathActivity("conversion", "decoding png");

      const violations = endCriticalPathWindow();
      expect(isCriticalPathWindowOpen()).toBe(false);
      expect(violations).toEqual([
        { kind: "network", detail: "fetching sync status", atMs: 1000 },
        { kind: "conversion", detail: "decoding png", atMs: 1050 },
      ]);
    });

    test("does not record activity if window is closed", () => {
      markCriticalPathActivity("network", "will be ignored");
      beginCriticalPathWindow("win");
      markCriticalPathActivity("network", "will be kept");
      const violations = endCriticalPathWindow();
      expect(violations.length).toBe(1);
      expect(violations[0].detail).toBe("will be kept");
    });
  });

  describe("Fixtures", () => {
    test("buildBudgetPalette creates exactly size distinct colors and valid DMC codes", () => {
      const palette = buildBudgetPalette(60);
      expect(palette.length).toBe(60);

      const dmcCodes = new Set(palette.map((p) => p.dmcCode));
      expect(dmcCodes.size).toBe(60);

      palette.forEach((entry) => {
        expect(entry.rgbHex).toMatch(/^#[0-9A-F]{6}$/);
      });
    });

    test("buildBudgetPattern is deterministic", () => {
      const p1 = buildBudgetPattern({ seed: 1234 });
      const p2 = buildBudgetPattern({ seed: 1234 });
      const p3 = buildBudgetPattern({ seed: 5678 });

      expect(p1.width).toBe(300);
      expect(p1.height).toBe(300);
      expect(p1.grid.length).toBe(300 * 300);

      expect(p1.grid).toEqual(p2.grid);
      expect(p1.grid).not.toEqual(p3.grid);
    });

    test("buildCompletedMask produces exactly target ratio of completed cells", () => {
      const pattern = buildBudgetPattern({ width: 100, height: 100 });

      // 85% completed
      const mask = buildCompletedMask(pattern, 0.85, 42);
      let count = 0;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] === 1) count++;
      }
      expect(count).toBe(8500);

      // Determinism test
      const mask2 = buildCompletedMask(pattern, 0.85, 42);
      expect(mask).toEqual(mask2);
    });

    test("buildLatePlayFixture and buildFullyCompletedFixture conform to specs", () => {
      const latePlay = buildLatePlayFixture(99);
      expect(latePlay.pattern.width).toBe(300);
      expect(latePlay.pattern.height).toBe(300);
      let completedCount = 0;
      for (let i = 0; i < latePlay.completed.length; i++) {
        if (latePlay.completed[i] === 1) completedCount++;
      }
      expect(completedCount).toBe(Math.round(300 * 300 * 0.85));

      const fully = buildFullyCompletedFixture(100);
      let fullyCount = 0;
      for (let i = 0; i < fully.completed.length; i++) {
        if (fully.completed[i] === 1) fullyCount++;
      }
      expect(fullyCount).toBe(300 * 300);
    });
  });

  describe("evaluateScenario", () => {
    test("evaluates latency scenario correctly (pass and fail cases)", () => {
      // Pass latency
      const samplesPass = Array(100).fill(20); // 100 samples, all 20ms (p95 = 20ms <= 50ms)
      const measurePass: ScenarioMeasurement = {
        scenarioId: "stitch-latency",
        startedAtIso: new Date().toISOString(),
        durationMs: 500,
        latencySamplesMs: samplesPass,
        criticalPathViolations: [],
      };
      const resPass = evaluateScenario(measurePass);
      expect(resPass.passed).toBe(true);
      expect(resPass.failures.length).toBe(0);

      // Fail latency: high p95
      const samplesFail = Array(90).fill(10).concat(Array(10).fill(80)); // p95 is 80ms > 50ms
      const measureFail: ScenarioMeasurement = {
        ...measurePass,
        latencySamplesMs: samplesFail,
      };
      const resFail = evaluateScenario(measureFail);
      expect(resFail.passed).toBe(false);
      expect(resFail.failures[0]).toContain("exceeds 50 ms budget");

      // Fail latency: insufficient samples
      const measureLowSamples: ScenarioMeasurement = {
        ...measurePass,
        latencySamplesMs: Array(50).fill(10), // only 50 samples
      };
      const resLowSamples = evaluateScenario(measureLowSamples);
      expect(resLowSamples.passed).toBe(false);
      expect(resLowSamples.failures[0]).toContain("below minimum requirement");
    });

    test("evaluates frame-rate scenario correctly (pass and fail cases)", () => {
      // Pass frame rate
      // 300 frames of 16.6ms -> mean frame time 16.6ms (~60.2 fps), p99 16.6ms <= 33ms, 0 slow frames
      const intervalsPass = Array(300).fill(16.6);
      const measurePass: ScenarioMeasurement = {
        scenarioId: "pan",
        startedAtIso: new Date().toISOString(),
        durationMs: 5000,
        frameIntervalsMs: intervalsPass,
        criticalPathViolations: [],
      };
      const resPass = evaluateScenario(measurePass);
      expect(resPass.passed).toBe(true);

      // Fail mean fps
      const intervalsLowFps = Array(300).fill(25.0); // mean frame time 25.0ms (40 fps < 58 fps budget)
      const resLowFps = evaluateScenario({ ...measurePass, frameIntervalsMs: intervalsLowFps });
      expect(resLowFps.passed).toBe(false);
      expect(resLowFps.failures.some((f) => f.includes("below 58 fps budget"))).toBe(true);

      // Fail slow frames ratio
      // 280 frames of 16.6ms, 20 frames of 21ms. Slow frame ratio = 20/300 = 6.67% > 5% budget
      const intervalsSlowRatio = Array(280).fill(16.6).concat(Array(20).fill(21));
      const resSlowRatio = evaluateScenario({ ...measurePass, frameIntervalsMs: intervalsSlowRatio });
      expect(resSlowRatio.passed).toBe(false);
      expect(resSlowRatio.failures.some((f) => f.includes("exceeds 5% budget"))).toBe(true);

      // Fail p99 frame time
      // 295 frames of 16.6ms, 5 frames of 40ms. p99 is 40ms > 33ms budget
      const intervalsHighP99 = Array(295).fill(16.6).concat(Array(5).fill(40));
      const resHighP99 = evaluateScenario({ ...measurePass, frameIntervalsMs: intervalsHighP99 });
      expect(resHighP99.passed).toBe(false);
      expect(resHighP99.failures.some((f) => f.includes("exceeds 33 ms budget"))).toBe(true);
    });

    test("evaluates sustained-15min scenario correctly", () => {
      const baseMeasure: ScenarioMeasurement = {
        scenarioId: "sustained-15min",
        startedAtIso: new Date().toISOString(),
        durationMs: 15 * 60 * 1000, // 15 minutes
        frameIntervalsMs: Array(300).fill(16.6),
        thermalSamples: ["nominal", "nominal", "fair"],
        criticalPathViolations: [],
      };

      // Pass
      const resPass = evaluateScenario(baseMeasure);
      expect(resPass.passed).toBe(true);

      // Fail thermal: serious state reached
      const resSeriousThermal = evaluateScenario({
        ...baseMeasure,
        thermalSamples: ["nominal", "serious"],
      });
      expect(resSeriousThermal.passed).toBe(false);
      expect(
        resSeriousThermal.failures.some((f) => f.includes('reached or exceeded "serious"'))
      ).toBe(true);

      // Fail thermal: device cannot report thermal state at all
      const resUnsupportedThermal = evaluateScenario({
        ...baseMeasure,
        thermalSamples: ["unsupported", "unsupported"],
      });
      expect(resUnsupportedThermal.passed).toBe(false);
      expect(
        resUnsupportedThermal.failures.some((f) => f.includes("thermal state unavailable"))
      ).toBe(true);

      // Fail duration: under 15 minutes
      const resShortDuration = evaluateScenario({
        ...baseMeasure,
        durationMs: 14 * 60 * 1000,
      });
      expect(resShortDuration.passed).toBe(false);
      expect(resShortDuration.failures.some((f) => f.includes("below minimum requirement"))).toBe(true);
    });

    test("fails if critical path is violated", () => {
      const violations: CriticalPathViolation[] = [
        { kind: "network", detail: "synced with server", atMs: 100 },
      ];
      const measure: ScenarioMeasurement = {
        scenarioId: "stitch-latency",
        startedAtIso: new Date().toISOString(),
        durationMs: 500,
        latencySamplesMs: Array(100).fill(15),
        criticalPathViolations: violations,
      };
      const res = evaluateScenario(measure);
      expect(res.passed).toBe(false);
      expect(res.failures[0]).toContain("critical path violation [network]");
    });
  });

  describe("buildRunReport and formatRunReport", () => {
    const mockFixture = {
      width: 300,
      height: 300,
      paletteSize: 60,
      completedRatio: 0.85,
    };
    const mockDevice = {
      platform: "ios" as const,
      osVersion: "16.4",
      model: "iPhone 13",
      isReferenceDevice: true,
    };

    // Helper to generate a minimal passing measurement for a scenario ID
    function makePassingMeasurement(id: ScenarioId): ScenarioMeasurement {
      const isLatency = id === "stitch-latency" || id === "undo-latency" || id === "worst-case-app-resume";
      const isSustained = id === "sustained-15min";
      return {
        scenarioId: id,
        startedAtIso: new Date().toISOString(),
        durationMs: isSustained ? 15 * 60 * 1000 : 1000,
        latencySamplesMs: isLatency ? Array(100).fill(10) : undefined,
        frameIntervalsMs: !isLatency ? Array(300).fill(16.6) : undefined,
        thermalSamples: isSustained ? ["nominal"] : undefined,
        criticalPathViolations: [],
      };
    }

    test("builds passing run report with all required scenarios on a reference device", () => {
      const measurements = REQUIRED_SCENARIOS.map((id) => makePassingMeasurement(id));
      const report = buildRunReport({
        appVersion: "1.0.0",
        device: mockDevice,
        fixture: mockFixture,
        measurements,
      });

      expect(report.passed).toBe(true);
      expect(report.failures.length).toBe(0);
      expect(report.results.length).toBe(REQUIRED_SCENARIOS.length);
    });

    test("fails run if a required scenario is missing", () => {
      const measurements = REQUIRED_SCENARIOS.slice(1).map((id) => makePassingMeasurement(id)); // missing the first scenario
      const report = buildRunReport({
        appVersion: "1.0.0",
        device: mockDevice,
        fixture: mockFixture,
        measurements,
      });

      expect(report.passed).toBe(false);
      expect(report.failures.some((f) => f.includes("Missing required scenario"))).toBe(true);
    });

    test("fails run if device is not a reference device", () => {
      const measurements = REQUIRED_SCENARIOS.map((id) => makePassingMeasurement(id));
      const nonRefDevice = { ...mockDevice, isReferenceDevice: false };
      const report = buildRunReport({
        appVersion: "1.0.0",
        device: nonRefDevice,
        fixture: mockFixture,
        measurements,
      });

      expect(report.passed).toBe(false);
      expect(report.failures.some((f) => f.includes("Device is not a designated reference device"))).toBe(true);
    });

    test("formats report correctly into tabular ascii representation", () => {
      const measurements = REQUIRED_SCENARIOS.map((id) => makePassingMeasurement(id));
      const report = buildRunReport({
        appVersion: "1.0.0",
        gitSha: "abcd123",
        device: mockDevice,
        fixture: mockFixture,
        measurements,
      });

      const formatted = formatRunReport(report);
      expect(formatted).toContain("STITCH INTERACTION BUDGET PERFORMANCE REPORT");
      expect(formatted).toContain("RELEASE GATE: PASS");
      expect(formatted).toContain("stitch-latency");
      expect(formatted).toContain("sustained-15min");
    });
  });
});
