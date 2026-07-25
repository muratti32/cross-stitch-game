import * as fs from 'fs';
import * as path from 'path';
import {
  LATENCY_MIN_SAMPLES,
  PERF_REPORT_SCHEMA_VERSION,
  REQUIRED_SCENARIOS,
  SCENARIO_KIND,
  STITCH_INTERACTION_BUDGET,
} from '../src/perf/budgets';
import {
  PerfRunReport,
  ScenarioResult,
  formatRunReport,
} from '../src/perf/report';

// CLI interface definition
export interface CliArgs {
  reports: string[];
  allowThermalUnsupported?: string;
  json: boolean;
}

export interface GateResult {
  status: 'PASS' | 'WAIVED' | 'FAIL';
  failures: string[];
  waivedFailures: string[];
  waiverReason?: string;
  reportsEvaluated: {
    platform: 'ios' | 'android';
    model: string;
    osVersion: string;
    isReferenceDevice: boolean;
    passed: boolean;
    failures: string[];
  }[];
}

// Deep comparison helper for report agreement
export function reportsAgree(r1: PerfRunReport, r2: PerfRunReport): boolean {
  if (
    r1.device.platform !== r2.device.platform ||
    r1.device.osVersion !== r2.device.osVersion ||
    r1.device.model !== r2.device.model ||
    r1.device.isReferenceDevice !== r2.device.isReferenceDevice
  ) {
    return false;
  }
  if (r1.results.length !== r2.results.length) {
    return false;
  }
  for (const res1 of r1.results) {
    const res2 = r2.results.find((r) => r.scenarioId === res1.scenarioId);
    if (!res2) return false;
    if (res1.passed !== res2.passed) return false;
    
    const f1 = new Set(res1.failures);
    const f2 = new Set(res2.failures);
    if (f1.size !== f2.size) return false;
    for (const f of f1) {
      if (!f2.has(f)) return false;
    }
    
    if (res1.latency || res2.latency) {
      if (!res1.latency || !res2.latency) return false;
      if (
        res1.latency.p95Ms !== res2.latency.p95Ms ||
        res1.latency.sampleCount !== res2.latency.sampleCount
      ) {
        return false;
      }
    }
    if (res1.thermal || res2.thermal) {
      if (!res1.thermal || !res2.thermal) return false;
      if (res1.thermal.worst !== res2.thermal.worst) return false;
    }
    if (res1.durationMs !== res2.durationMs) return false;
  }
  return true;
}

// Validate that the report has the correct shape
export function validateReportShape(report: unknown): string[] {
  const errors: string[] = [];
  if (!report || typeof report !== 'object') {
    errors.push('Report is not a valid JSON object.');
    return errors;
  }
  const r = report as Record<string, unknown>;
  if (typeof r.schemaVersion !== 'number') {
    errors.push("Missing or invalid 'schemaVersion' (must be a number).");
  }
  if (typeof r.generatedAtIso !== 'string') {
    errors.push("Missing or invalid 'generatedAtIso' (must be a string).");
  }
  if (typeof r.appVersion !== 'string') {
    errors.push("Missing or invalid 'appVersion' (must be a string).");
  }
  if (!r.device || typeof r.device !== 'object') {
    errors.push("Missing or invalid 'device' configuration object.");
  } else {
    const dev = r.device as Record<string, unknown>;
    if (dev.platform !== 'ios' && dev.platform !== 'android') {
      errors.push(`Invalid device platform '${dev.platform}' (must be 'ios' or 'android').`);
    }
    if (typeof dev.osVersion !== 'string' || dev.osVersion.trim() === '') {
      errors.push("Missing or invalid device 'osVersion'.");
    }
    if (typeof dev.model !== 'string' || dev.model.trim() === '') {
      errors.push("Missing or invalid device 'model'.");
    }
    if (typeof dev.isReferenceDevice !== 'boolean') {
      errors.push("Missing or invalid device 'isReferenceDevice' (must be a boolean).");
    }
  }
  if (!r.fixture || typeof r.fixture !== 'object') {
    errors.push("Missing or invalid 'fixture' configuration object.");
  } else {
    const fix = r.fixture as Record<string, unknown>;
    if (
      typeof fix.width !== 'number' ||
      typeof fix.height !== 'number' ||
      typeof fix.paletteSize !== 'number' ||
      typeof fix.completedRatio !== 'number'
    ) {
      errors.push('Fixture configuration must contain numeric width, height, paletteSize, and completedRatio.');
    }
  }
  if (!Array.isArray(r.results)) {
    errors.push("Missing or invalid 'results' (must be an array of ScenarioResult).");
  } else {
    const results = r.results as unknown[];
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (!res || typeof res !== 'object') {
        errors.push(`results[${i}] is not an object.`);
        continue;
      }
      const resObj = res as Record<string, unknown>;
      if (typeof resObj.scenarioId !== 'string') {
        errors.push(`results[${i}] is missing a valid 'scenarioId'.`);
      }
      if (typeof resObj.passed !== 'boolean') {
        errors.push(`results[${i}] scenario '${resObj.scenarioId}' is missing 'passed' (must be a boolean).`);
      }
      if (!Array.isArray(resObj.failures)) {
        errors.push(`results[${i}] scenario '${resObj.scenarioId}' is missing 'failures' (must be an array of strings).`);
      }
      if (typeof resObj.durationMs !== 'number') {
        errors.push(`results[${i}] scenario '${resObj.scenarioId}' is missing 'durationMs' (must be a number).`);
      }
    }
  }
  if (typeof r.passed !== 'boolean') {
    errors.push("Missing or invalid 'passed' (must be a boolean).");
  }
  if (!Array.isArray(r.failures)) {
    errors.push("Missing or invalid 'failures' (must be an array of strings).");
  }
  return errors;
}

/**
 * Re-derives the ADR-0031 verdict for one scenario from the numbers the report
 * carries, independent of the `passed` / `failures` fields written by the device
 * harness. A report that reports a green scenario while its own measurements
 * breach the budget is treated as a failure, not as a pass.
 */
export function rederiveScenarioFailures(res: ScenarioResult): string[] {
  const failures: string[] = [];
  const kind = SCENARIO_KIND[res.scenarioId];
  const budget = STITCH_INTERACTION_BUDGET;

  if (kind === 'latency' || res.latency !== undefined) {
    if (res.latency === undefined) {
      failures.push(`${res.scenarioId}: latency measurement missing from report`);
    } else {
      const minSamples = LATENCY_MIN_SAMPLES[res.scenarioId] ?? budget.latency.minSamples;
      if (res.latency.sampleCount < minSamples) {
        failures.push(
          `${res.scenarioId}: sample count ${res.latency.sampleCount} is below minimum requirement of ${minSamples}`
        );
      }
      if (res.latency.p95Ms > budget.latency.p95MaxMs) {
        failures.push(
          `${res.scenarioId}: p95 latency ${res.latency.p95Ms.toFixed(1)} ms exceeds ${budget.latency.p95MaxMs} ms budget`
        );
      }
    }
  }

  if (kind === 'frame-rate' || kind === 'sustained') {
    if (res.frames === undefined) {
      failures.push(`${res.scenarioId}: frame measurement missing from report`);
    } else {
      const f = res.frames;
      if (f.frameCount < budget.frameRate.minSamples) {
        failures.push(
          `${res.scenarioId}: sample count ${f.frameCount} is below minimum requirement of ${budget.frameRate.minSamples}`
        );
      }
      if (f.meanFps < budget.frameRate.minMeanFps) {
        failures.push(
          `${res.scenarioId}: mean fps ${f.meanFps.toFixed(1)} is below ${budget.frameRate.minMeanFps} fps budget`
        );
      }
      if (f.slowFrameRatio > budget.frameRate.maxSlowFrameRatio) {
        failures.push(
          `${res.scenarioId}: ratio of slow frames ${(f.slowFrameRatio * 100).toFixed(1)}% exceeds ${(budget.frameRate.maxSlowFrameRatio * 100).toFixed(0)}% budget`
        );
      }
      if (f.p99FrameMs > budget.frameRate.p99MaxFrameMs) {
        failures.push(
          `${res.scenarioId}: p99 frame time ${f.p99FrameMs.toFixed(1)} ms exceeds ${budget.frameRate.p99MaxFrameMs} ms budget`
        );
      }
    }
  }

  if (kind === 'sustained') {
    const minDurationMs = budget.sustained.minDurationMinutes * 60 * 1000;
    if (res.durationMs < minDurationMs) {
      failures.push(
        `${res.scenarioId}: duration ${res.durationMs} ms is below the required ${minDurationMs} ms`
      );
    }
    if (res.thermal === undefined) {
      failures.push(`${res.scenarioId}: thermal measurement missing from report`);
    } else if (res.thermal.worst === 'unsupported') {
      failures.push(
        `${res.scenarioId}: thermal state unavailable on this device; ADR-0031 requires heat to be measured on hardware`
      );
    } else if (res.thermal.worst === 'serious' || res.thermal.worst === 'critical') {
      failures.push(
        `${res.scenarioId}: worst thermal state "${res.thermal.worst}" reached or exceeded "serious"`
      );
    }
  }

  return failures;
}

// Pure gate evaluation logic
export function evaluateGate(
  reports: PerfRunReport[],
  allowThermalUnsupportedReason?: string
): GateResult {
  const globalFailures: string[] = [];
  const allHardFailures: string[] = [];
  const allWaivedFailures: string[] = [];

  const iosReports = reports.filter((r) => r.device.platform === 'ios');
  const androidReports = reports.filter((r) => r.device.platform === 'android');

  const uniqueReports: PerfRunReport[] = [];

  // Check iOS reports
  if (iosReports.length === 0) {
    globalFailures.push('Missing iOS performance report.');
  } else {
    let allAgree = true;
    for (let i = 1; i < iosReports.length; i++) {
      if (!reportsAgree(iosReports[0], iosReports[i])) {
        allAgree = false;
        break;
      }
    }
    if (!allAgree) {
      globalFailures.push('Multiple conflicting iOS performance reports.');
    } else {
      uniqueReports.push(iosReports[0]);
    }
  }

  // Check Android reports
  if (androidReports.length === 0) {
    globalFailures.push('Missing Android performance report.');
  } else {
    let allAgree = true;
    for (let i = 1; i < androidReports.length; i++) {
      if (!reportsAgree(androidReports[0], androidReports[i])) {
        allAgree = false;
        break;
      }
    }
    if (!allAgree) {
      globalFailures.push('Multiple conflicting Android performance reports.');
    } else {
      uniqueReports.push(androidReports[0]);
    }
  }

  allHardFailures.push(...globalFailures);

  const reportsEvaluated: GateResult['reportsEvaluated'] = [];

  for (const report of uniqueReports) {
    const reportHardFailures: string[] = [];
    const reportWaivedFailures: string[] = [];

    // Rule: device.isReferenceDevice must be true
    if (!report.device.isReferenceDevice) {
      reportHardFailures.push(`[${report.device.platform}] Run failed: Device is not a designated reference device.`);
    }

    // Rule: every scenario in REQUIRED_SCENARIOS must be present
    const presentIds = new Set(report.results.map((r) => r.scenarioId));
    for (const requiredId of REQUIRED_SCENARIOS) {
      if (!presentIds.has(requiredId)) {
        reportHardFailures.push(`[${report.device.platform}] Run failed: Missing required scenario measurement "${requiredId}".`);
      }
    }

    // Rule: every ScenarioResult.passed must be true OR waivable
    let strictReportPassed = true;
    for (const res of report.results) {
      // The gate never trusts the harness verdict: it re-derives the failures
      // from the reported numbers and unions them with what the device wrote.
      const rederived = rederiveScenarioFailures(res);
      const reportedFailures = res.passed ? [] : res.failures;
      const effectiveFailures = [...new Set([...reportedFailures, ...rederived])];

      if (effectiveFailures.length > 0) {
        strictReportPassed = false;
        for (const failMsg of effectiveFailures) {
          const isThermalUnsupported =
            res.thermal?.worst === 'unsupported' &&
            (failMsg.includes('thermal state unavailable') || failMsg.includes('thermal worst state "unsupported"'));

          if (isThermalUnsupported && allowThermalUnsupportedReason && allowThermalUnsupportedReason.trim() !== '') {
            reportWaivedFailures.push(`[${report.device.platform}] ${failMsg} (Waived)`);
          } else {
            reportHardFailures.push(`[${report.device.platform}] ${failMsg}`);
          }
        }
      }
    }

    // Additional check on strictPassed for the report itself:
    if (!report.device.isReferenceDevice || presentIds.size < REQUIRED_SCENARIOS.length) {
      strictReportPassed = false;
    }

    // Tamper / staleness check:
    if (report.passed && !strictReportPassed) {
      reportHardFailures.push(
        `[${report.device.platform}] TAMPER/STALENESS CHECK: Report claims passed: true but contains failures or invalid configurations.`
      );
    }

    allHardFailures.push(...reportHardFailures);
    allWaivedFailures.push(...reportWaivedFailures);

    reportsEvaluated.push({
      platform: report.device.platform,
      model: report.device.model,
      osVersion: report.device.osVersion,
      isReferenceDevice: report.device.isReferenceDevice,
      passed: reportHardFailures.length === 0,
      failures: [...reportHardFailures, ...reportWaivedFailures],
    });
  }

  let status: GateResult['status'] = 'PASS';
  if (allHardFailures.length > 0) {
    status = 'FAIL';
  } else if (allWaivedFailures.length > 0) {
    status = 'WAIVED';
  }

  return {
    status,
    failures: allHardFailures,
    waivedFailures: allWaivedFailures,
    waiverReason: status === 'WAIVED' ? allowThermalUnsupportedReason : undefined,
    reportsEvaluated,
  };
}

// Helper to parse Command Line Arguments
export function parseCliArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    reports: [],
    json: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--reports') {
      i++;
      while (i < args.length && !args[i].startsWith('-')) {
        result.reports.push(args[i]);
        i++;
      }
    } else if (arg === '--allow-thermal-unsupported') {
      i++;
      if (i < args.length && !args[i].startsWith('-')) {
        result.allowThermalUnsupported = args[i];
        i++;
      } else {
        result.allowThermalUnsupported = '';
      }
    } else if (arg === '--json') {
      result.json = true;
      i++;
    } else {
      // Skip unknown flags/args
      i++;
    }
  }
  return result;
}

// Main CLI Entrypoint
export function runCli(): void {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (parsed.reports.length === 0) {
    console.error('Error: Missing required option --reports <dir-or-file...>');
    console.error('Usage: npm run perf:gate -- --reports <dir-or-file...> [--allow-thermal-unsupported "<reason>"] [--json]');
    process.exit(2);
  }

  const reportsToLoad: string[] = [];

  for (const repPath of parsed.reports) {
    const absPath = path.resolve(repPath);
    if (!fs.existsSync(absPath)) {
      console.error(`Error: Report path does not exist: ${repPath}`);
      process.exit(2);
    }
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(absPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          reportsToLoad.push(path.join(absPath, file));
        }
      }
    } else {
      reportsToLoad.push(absPath);
    }
  }

  const loadedReports: PerfRunReport[] = [];

  for (const file of reportsToLoad) {
    let rawContent: string;
    try {
      rawContent = fs.readFileSync(file, 'utf8');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Error reading file ${file}: ${errMsg}`);
      process.exit(2);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawContent);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Error parsing JSON in ${file}: ${errMsg}`);
      process.exit(2);
    }

    const obj = parsedJson as Record<string, unknown>;

    // Validate schema version
    if (obj.schemaVersion !== undefined && obj.schemaVersion !== PERF_REPORT_SCHEMA_VERSION) {
      console.error(
        `Error: Schema version mismatch in ${file}. Expected schema version ${PERF_REPORT_SCHEMA_VERSION}, found ${obj.schemaVersion}.`
      );
      process.exit(2);
    }

    // Validate shape
    const shapeErrors = validateReportShape(parsedJson);
    if (shapeErrors.length > 0) {
      console.error(`Error: Invalid report shape in ${file}:`);
      for (const err of shapeErrors) {
        console.error(` - ${err}`);
      }
      process.exit(2);
    }

    loadedReports.push(parsedJson as PerfRunReport);
  }

  const evaluation = evaluateGate(loadedReports, parsed.allowThermalUnsupported);

  if (parsed.json) {
    console.log(JSON.stringify(evaluation, null, 2));
  } else {
    // Human-readable format
    for (const report of loadedReports) {
      console.log(formatRunReport(report));
      console.log('\n');
    }

    console.log('================================================================================');
    console.log(`RELEASE GATE (ADR-0031 Stitch Interaction Budget): ${evaluation.status}`);
    console.log('================================================================================');

    if (evaluation.status === 'FAIL') {
      console.log('FAILURES:');
      for (const fail of evaluation.failures) {
        console.log(`- ${fail}`);
      }
    } else if (evaluation.status === 'WAIVED') {
      console.log(`WAIVER ECHOED PROMINENTLY: --allow-thermal-unsupported was passed.`);
      console.log(`Reason for waiver: "${evaluation.waiverReason}"`);
      console.log('\nWAIVED THERMAL WARNINGS:');
      for (const fail of evaluation.waivedFailures) {
        console.log(`- ${fail}`);
      }
    } else {
      console.log('All performance and thermal constraints passed successfully.');
    }
    console.log('================================================================================');
  }

  if (evaluation.status === 'FAIL') {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Module process entry check
const isMain =
  typeof require !== 'undefined' && require.main === module
    ? true
    : process.argv[1]
    ? path.resolve(process.argv[1]) === __filename ||
      path.resolve(process.argv[1]) === path.resolve(__dirname, 'perf-gate.ts') ||
      path.resolve(process.argv[1]) === path.resolve(__dirname, 'perf-gate')
    : false;

if (isMain) {
  runCli();
}
