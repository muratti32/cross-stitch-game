import { evaluateGate } from '../perf-gate';
import { PerfRunReport } from '../../src/perf/report';

import { ScenarioId } from '../../src/perf/budgets';

// Helper to create a valid base report
function createBaseReport(platform: 'ios' | 'android', options: {
  isReferenceDevice?: boolean;
  passed?: boolean;
  missingScenario?: string;
  failingScenario?: string;
  thermalUnsupported?: boolean;
} = {}): PerfRunReport {
  const isReferenceDevice = options.isReferenceDevice ?? true;
  const defaultPassed = !(
    options.isReferenceDevice === false ||
    options.missingScenario !== undefined ||
    options.failingScenario !== undefined ||
    options.thermalUnsupported === true
  );
  const passed = options.passed ?? defaultPassed;

  const scenarios: ScenarioId[] = [
    'stitch-latency',
    'undo-latency',
    'pan',
    'anchored-zoom',
    'stitch-sweep',
    'worst-case-fully-completed',
    'worst-case-rapid-stitch-during-pan-zoom',
    'worst-case-memory-pressure',
    'worst-case-gpu-context-loss',
    'worst-case-app-resume',
    'sustained-15min',
  ];

  const results = scenarios
    .filter((id) => id !== options.missingScenario)
    .map((id) => {
      const isFailing = id === options.failingScenario;
      const isThermalFail = id === 'sustained-15min' && options.thermalUnsupported;

      // Healthy measurements that satisfy every ADR-0031 threshold; the gate
      // re-derives its verdict from these numbers, so they must be realistic.
      const healthyLatency = { p95Ms: 32, sampleCount: 200 };
      const healthyFrames = {
        frameCount: 1200,
        meanFrameMs: 16.6,
        meanFps: 60.2,
        p99FrameMs: 19,
        slowFrameRatio: 0.01,
      };

      if (isThermalFail) {
        return {
          scenarioId: id,
          passed: false,
          failures: [`${id}: thermal state unavailable on this device; ADR-0031 requires heat to be measured on hardware`],
          frames: healthyFrames,
          thermal: { worst: 'unsupported' as const },
          durationMs: 900000,
        };
      }

      if (isFailing) {
        return {
          scenarioId: id,
          passed: false,
          failures: [`${id}: latency exceeds budget`],
          latency: { p95Ms: 71, sampleCount: 200 },
          durationMs: 100,
        };
      }

      if (id === 'sustained-15min') {
        return {
          scenarioId: id,
          passed: true,
          failures: [],
          frames: healthyFrames,
          thermal: { worst: 'fair' as const },
          durationMs: 15 * 60 * 1000,
        };
      }

      const isLatencyScenario =
        id === 'stitch-latency' || id === 'undo-latency' || id === 'worst-case-app-resume';

      return {
        scenarioId: id,
        passed: true,
        failures: [],
        latency: isLatencyScenario
          ? { p95Ms: healthyLatency.p95Ms, sampleCount: id === 'worst-case-app-resume' ? 10 : 200 }
          : undefined,
        frames: isLatencyScenario ? undefined : healthyFrames,
        durationMs: 30_000,
      };
    });

  return {
    schemaVersion: 1,
    generatedAtIso: new Date().toISOString(),
    appVersion: '1.0.0',
    device: {
      platform,
      osVersion: platform === 'ios' ? '16.4' : '7.0',
      model: platform === 'ios' ? 'iPhone 11' : 'Nexus 6P',
      isReferenceDevice,
    },
    fixture: {
      width: 300,
      height: 300,
      paletteSize: 60,
      completedRatio: 0.85,
    },
    results,
    passed,
    failures: passed ? [] : ['Some scenario failed'],
  };
}

describe('Stitch Interaction Budget Release Gate', () => {
  it('passes when both platforms pass on reference devices with all scenarios', () => {
    const ios = createBaseReport('ios');
    const android = createBaseReport('android');

    const result = evaluateGate([ios, android]);

    expect(result.status).toBe('PASS');
    expect(result.failures).toHaveLength(0);
    expect(result.waivedFailures).toHaveLength(0);
  });

  it('fails when the Android report is missing', () => {
    const ios = createBaseReport('ios');

    const result = evaluateGate([ios]);

    expect(result.status).toBe('FAIL');
    expect(result.failures).toContain('Missing Android performance report.');
  });

  it('fails when a required scenario is missing', () => {
    const ios = createBaseReport('ios');
    const android = createBaseReport('android', { missingScenario: 'stitch-latency' });

    const result = evaluateGate([ios, android]);

    expect(result.status).toBe('FAIL');
    expect(result.failures.some((f) => f.includes('Missing required scenario measurement "stitch-latency"'))).toBe(true);
  });

  it('fails when a non-reference device is evaluated', () => {
    const ios = createBaseReport('ios', { isReferenceDevice: false });
    const android = createBaseReport('android');

    const result = evaluateGate([ios, android]);

    expect(result.status).toBe('FAIL');
    expect(result.failures.some((f) => f.includes('Device is not a designated reference device.'))).toBe(true);
  });

  it('fails when a scenario fails standard budgets', () => {
    const ios = createBaseReport('ios', { failingScenario: 'stitch-latency' });
    const android = createBaseReport('android');

    const result = evaluateGate([ios, android]);

    expect(result.status).toBe('FAIL');
    expect(result.failures.some((f) => f.includes('stitch-latency: latency exceeds budget'))).toBe(true);
  });

  it('fails on thermal unsupported without a waiver', () => {
    const ios = createBaseReport('ios');
    const android = createBaseReport('android', { thermalUnsupported: true });

    const result = evaluateGate([ios, android]);

    expect(result.status).toBe('FAIL');
    expect(result.failures.some((f) => f.includes('thermal state unavailable on this device'))).toBe(true);
  });

  it('waives thermal unsupported when a non-empty reason is provided', () => {
    const ios = createBaseReport('ios');
    const android = createBaseReport('android', { thermalUnsupported: true });

    const result = evaluateGate([ios, android], 'Android below API 29');

    expect(result.status).toBe('WAIVED');
    expect(result.failures).toHaveLength(0);
    expect(result.waivedFailures.some((f) => f.includes('thermal state unavailable on this device'))).toBe(true);
    expect(result.waiverReason).toBe('Android below API 29');
  });

  it('fails on tampered reports (report claims passed: true but contains failed results)', () => {
    const ios = createBaseReport('ios');
    const android = createBaseReport('android', { failingScenario: 'stitch-latency', passed: true });

    const result = evaluateGate([ios, android]);

    expect(result.status).toBe('FAIL');
    expect(result.failures.some((f) => f.includes('TAMPER/STALENESS CHECK'))).toBe(true);
  });

  it('re-derives the verdict from the numbers when a scenario claims a green result', () => {
    const ios = createBaseReport('ios');
    const android = createBaseReport('android');
    const stitchLatency = android.results.find((r) => r.scenarioId === 'stitch-latency');
    expect(stitchLatency).toBeDefined();
    // A scenario that reports itself green while its own p95 breaches the 50 ms budget.
    if (stitchLatency) {
      stitchLatency.passed = true;
      stitchLatency.failures = [];
      stitchLatency.latency = { p95Ms: 88.4, sampleCount: 200 };
    }

    const result = evaluateGate([ios, android]);

    expect(result.status).toBe('FAIL');
    expect(
      result.failures.some((f) => f.includes('p95 latency 88.4 ms exceeds 50 ms budget'))
    ).toBe(true);
  });
});
