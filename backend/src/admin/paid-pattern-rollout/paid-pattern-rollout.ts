import type { PatternPaidBulkResult } from '../pattern-paid-admin.service';
import type {
  BulkSetPaidResponse,
  OperatorLoginInput,
  StaffPickResponseItem,
} from './operator-api-client';
import {
  selectPaidPatterns,
  type PaidPatternCandidate,
  type PaidPatternSelectionResult,
} from './paid-pattern-selection';

export interface PaidPatternRolloutOptions {
  seed: string;
  envLabel: string;
  apiUrl: string;
  reportPath?: string;
  apply: boolean;
  /** Applies the same selection in the free direction (ADR-0061 paid -> free). */
  revert: boolean;
  confirmDigest?: string;
  credentials: OperatorLoginInput;
}

export interface PaidPatternRolloutClient {
  login(input: OperatorLoginInput): Promise<void>;
  listPatterns(status: string): Promise<PaidPatternCandidate[]>;
  getStaffPicks(): Promise<StaffPickResponseItem[]>;
  bulkSetPaid(
    patternIds: string[],
    paid: boolean,
    requestId: string,
  ): Promise<BulkSetPaidResponse>;
}

export interface PaidPatternRolloutDependencies {
  client: PaidPatternRolloutClient;
  clock: () => Date;
  output: (line: string) => void;
  reportWriter: (path: string, report: PaidPatternRolloutReport) => Promise<void>;
}

export interface PaidPatternRolloutApplyCounts {
  changed: number;
  unchanged: number;
  failed: number;
  missing: number;
  grandfatheredCount: number;
}

export interface PaidPatternRolloutReport extends PaidPatternSelectionResult {
  generatedAt: string;
  envLabel: string;
  apiUrl: string;
  mode: 'dry-run' | 'apply' | 'revert';
  apply?: {
    appliedAt: string;
    requestIds: string[];
    results: PatternPaidBulkResult[];
    counts: PaidPatternRolloutApplyCounts;
    error?: string;
  };
}

export function parseRolloutArgs(
  argv: string[],
  env: Readonly<Record<string, string | undefined>>,
): PaidPatternRolloutOptions {
  const values = new Map<string, string>();
  let apply = false;
  let revert = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--apply') {
      apply = true;
      continue;
    }
    if (flag === '--revert') {
      revert = true;
      continue;
    }
    if (!['--seed', '--env-label', '--api-url', '--report', '--confirm-digest'].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (values.has(flag)) {
      throw new Error(`Duplicate argument: ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }

  const seed = requiredValue(values.get('--seed'), '--seed');
  const envLabel = requiredValue(values.get('--env-label'), '--env-label');
  const apiUrl = requiredValue(values.get('--api-url') ?? env.ADMIN_API_URL, '--api-url or ADMIN_API_URL');
  validateApiUrl(apiUrl);
  const email = requiredValue(env.ADMIN_EMAIL, 'ADMIN_EMAIL');
  const password = requiredValue(env.ADMIN_PASSWORD, 'ADMIN_PASSWORD');
  const totpCode = optionalValue(env.ADMIN_TOTP_CODE);
  const totpSecret = optionalValue(env.ADMIN_TOTP_SECRET);
  if (totpCode === undefined && totpSecret === undefined) {
    throw new Error('Missing ADMIN_TOTP_CODE or ADMIN_TOTP_SECRET');
  }
  const confirmDigest = optionalValue(values.get('--confirm-digest'));
  if (confirmDigest !== undefined && !/^[a-fA-F0-9]{64}$/.test(confirmDigest)) {
    throw new Error('--confirm-digest must be a 64-character SHA-256 hex digest');
  }
  if (apply && confirmDigest === undefined) {
    throw new Error('--confirm-digest is required with --apply');
  }
  const reportPath = optionalValue(values.get('--report'));
  // #260 requires the seed and the resulting Pattern IDs to be recorded, so an
  // apply run must leave a report file behind rather than console scrollback.
  if (apply && reportPath === undefined) {
    throw new Error('--report is required with --apply');
  }
  if (revert && !apply) {
    throw new Error('--revert requires --apply');
  }

  return {
    apiUrl,
    apply,
    confirmDigest,
    credentials: { email, password, totpCode, totpSecret },
    envLabel,
    reportPath,
    revert,
    seed,
  };
}

export async function runPaidPatternRollout(
  options: PaidPatternRolloutOptions,
  deps: PaidPatternRolloutDependencies,
): Promise<number> {
  await deps.client.login(options.credentials);
  const [candidates, staffPicks] = await Promise.all([
    deps.client.listPatterns('available'),
    deps.client.getStaffPicks(),
  ]);
  const selection = selectPaidPatterns({
    candidates,
    seed: options.seed,
    staffPickPatternIds: staffPicks.map((pick) => pick.patternId),
  });
  const generatedAt = deps.clock().toISOString();
  const report: PaidPatternRolloutReport = {
    ...selection,
    apiUrl: options.apiUrl,
    envLabel: options.envLabel,
    generatedAt,
    mode: options.apply ? (options.revert ? 'revert' : 'apply') : 'dry-run',
  };
  writeSummary(deps.output, report);

  if (!options.apply) {
    await writeReportIfRequested(options.reportPath, report, deps.reportWriter);
    return 0;
  }
  if (
    options.confirmDigest === undefined
    || options.confirmDigest.toLowerCase() !== selection.selectionDigest
  ) {
    deps.output(
      `Apply aborted: confirmed digest does not match ${selection.selectionDigest}`,
    );
    await writeReportIfRequested(options.reportPath, report, deps.reportWriter);
    return 1;
  }

  const requestIds: string[] = [];
  const results: PatternPaidBulkResult[] = [];
  const appliedAt = deps.clock().toISOString();
  try {
    const batches = chunk(selection.selectedPatternIds, 50);
    for (let index = 0; index < batches.length; index += 1) {
      const requestId = `${options.revert ? 'free' : 'paid'}-rollout-${selection.selectionDigest.slice(0, 12)}-b${index}`;
      requestIds.push(requestId);
      // Each batch locks and grandfathers 50 Patterns one by one, which can
      // outlast the operator access token, so every later batch re-authenticates.
      if (index > 0) {
        await deps.client.login(options.credentials);
      }
      const response = await deps.client.bulkSetPaid(batches[index], !options.revert, requestId);
      results.push(...response.results);
    }
  } catch (error: unknown) {
    report.apply = {
      appliedAt,
      counts: countApplyResults(selection.selectedPatternIds, results),
      error: error instanceof Error ? error.message : 'Unknown apply error',
      requestIds,
      results,
    };
    await writeReportIfRequested(options.reportPath, report, deps.reportWriter);
    deps.output(`Apply failed after ${results.length} results: ${report.apply.error}`);
    return 1;
  }

  const counts = countApplyResults(selection.selectedPatternIds, results);
  report.apply = { appliedAt, counts, requestIds, results };
  deps.output(
    `Apply: changed=${counts.changed} unchanged=${counts.unchanged} failed=${counts.failed} missing=${counts.missing} grandfathered=${counts.grandfatheredCount}`,
  );
  const failed = results.filter(
    (result): result is Extract<PatternPaidBulkResult, { outcome: 'failed' }> =>
      result.outcome === 'failed',
  );
  for (const result of failed) {
    deps.output(`Failed: ${result.patternId} ${result.errorCode}`);
  }
  await writeReportIfRequested(options.reportPath, report, deps.reportWriter);
  return counts.failed > 0 || counts.missing > 0 ? 1 : 0;
}

function writeSummary(
  output: (line: string) => void,
  report: PaidPatternRolloutReport,
): void {
  output(`Paid Pattern rollout ${report.mode} for ${report.envLabel}`);
  output(`Seed: ${report.seed}`);
  output(`Attempt: ${report.attempt}`);
  output(`Digest: ${report.selectionDigest}`);
  output('Category                    Eligible Usable Excluded Paid Free');
  for (const row of report.perCategory) {
    output(`${row.categoryCode.padEnd(27)} ${String(row.eligible).padStart(8)} ${String(row.usable).padStart(6)} ${String(row.excluded).padStart(8)} ${String(row.paid).padStart(4)} ${String(row.free).padStart(4)}`);
  }
  output(
    `Tiers: small=${report.perTier.small} medium=${report.perTier.medium} large=${report.perTier.large}`,
  );
  output(
    `Staff Picks: paid=${report.staffPicks.paid} usable=${report.staffPicks.usable} max=${report.staffPicks.maxPaid}`,
  );
  output(`Excluded: ${report.excluded.length}`);
  for (const item of report.excluded) {
    output(`Excluded: ${item.id} ${item.title} ${item.categoryCode} ${item.reason}`);
  }
  output(`Warnings: currently paid but not selected=${report.warnings.currentlyPaidNotSelected.length}`);
  for (const id of report.warnings.currentlyPaidNotSelected) {
    output(`Warning: currently paid but not selected ${id}`);
  }
  output(`Selected (${report.totalPaid}):`);
  for (const item of report.selected) {
    output(
      `${item.id} | ${item.title} | ${item.categoryCode} | ${item.tier} | staffPick=${item.staffPick}`,
    );
  }
}

function countApplyResults(
  selectedPatternIds: string[],
  results: PatternPaidBulkResult[],
): PaidPatternRolloutApplyCounts {
  const returnedIds = new Set(results.map((result) => result.patternId.toLowerCase()));
  let changed = 0;
  let unchanged = 0;
  let failed = 0;
  let grandfatheredCount = 0;
  for (const result of results) {
    if (result.outcome === 'failed') {
      failed += 1;
    } else {
      if (result.outcome === 'changed') changed += 1;
      else unchanged += 1;
      grandfatheredCount += result.grandfatheredCount;
    }
  }
  return {
    changed,
    failed,
    grandfatheredCount,
    missing: selectedPatternIds.filter((id) => !returnedIds.has(id)).length,
    unchanged,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function writeReportIfRequested(
  path: string | undefined,
  report: PaidPatternRolloutReport,
  writer: PaidPatternRolloutDependencies['reportWriter'],
): Promise<void> {
  if (path !== undefined) {
    await writer(path, report);
  }
}

function requiredValue(value: string | undefined, name: string): string {
  const normalized = optionalValue(value);
  if (normalized === undefined) throw new Error(`Missing required ${name}`);
  return normalized;
}

function optionalValue(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  return value.trim();
}

function validateApiUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Admin API URL must be an absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Admin API URL must use http or https');
  }
}
