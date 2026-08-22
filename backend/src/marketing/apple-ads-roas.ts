export type AppleAdsCohortWindowDays = 7 | 30 | 90;

export interface AppleAdsDimension {
  campaignId: string;
  adGroupId?: string | null;
  keywordId?: string | null;
}

export interface AppleAdsSpendRow extends AppleAdsDimension {
  /** Apple Ads report date in YYYY-MM-DD form. */
  date: string;
  /** Spend normalized to USD before aggregation. */
  spendUsd: number;
}

export interface RevenueCatAttributedRevenueRow extends AppleAdsDimension {
  /** Date of the attributed install/cohort. */
  cohortDate: string;
  /** Date on which RevenueCat recognized the net proceeds. */
  revenueDate: string;
  /** App Store proceeds after commission, normalized to USD. */
  netRevenueUsd: number;
}

export interface AppleAdsRoasRow extends AppleAdsDimension {
  cohortDate: string;
  cohortWindowDays: AppleAdsCohortWindowDays;
  spendUsd: number;
  netRevenueUsd: number;
  /** null means the cohort has no spend and ROAS is undefined. */
  roas: number | null;
  roasPercent: number | null;
}

interface AggregatedRow {
  cohortDate: string;
  campaignId: string;
  adGroupId: string | null;
  keywordId: string | null;
  spendUsd: number;
  netRevenueUsd: number;
}

/**
 * Calculates Apple Ads ROAS from two already-normalized sources:
 * Apple Ads spend and RevenueCat-attributed net proceeds.
 *
 * Revenue is cohort-limited by the install date and the requested window:
 * day 0 through day (window - 1) are included. Input rows must use the same
 * currency and the same attribution granularity; do not mix campaign totals
 * with ad-group or keyword detail rows or they will be double-counted.
 */
export function calculateAppleAdsRoas(input: {
  spendRows: readonly AppleAdsSpendRow[];
  revenueRows: readonly RevenueCatAttributedRevenueRow[];
  cohortWindowDays: AppleAdsCohortWindowDays;
}): AppleAdsRoasRow[] {
  const aggregates = new Map<string, AggregatedRow>();

  for (const spendRow of input.spendRows) {
    assertDate(spendRow.date, 'Apple Ads spend date');
    assertDimension(spendRow);
    assertNonNegativeFinite(spendRow.spendUsd, 'Apple Ads spend');
    const row = getOrCreate(aggregates, spendRow.date, spendRow);
    row.spendUsd += spendRow.spendUsd;
  }

  for (const revenueRow of input.revenueRows) {
    assertDate(revenueRow.cohortDate, 'RevenueCat cohort date');
    assertDate(revenueRow.revenueDate, 'RevenueCat revenue date');
    assertDimension(revenueRow);
    assertNonNegativeFinite(revenueRow.netRevenueUsd, 'RevenueCat net revenue');

    const ageInDays = daysBetween(revenueRow.cohortDate, revenueRow.revenueDate);
    if (ageInDays < 0 || ageInDays >= input.cohortWindowDays) continue;

    const row = getOrCreate(aggregates, revenueRow.cohortDate, revenueRow);
    row.netRevenueUsd += revenueRow.netRevenueUsd;
  }

  return [...aggregates.values()]
    .sort((left, right) =>
      left.cohortDate.localeCompare(right.cohortDate)
      || left.campaignId.localeCompare(right.campaignId)
      || (left.adGroupId ?? '').localeCompare(right.adGroupId ?? '')
      || (left.keywordId ?? '').localeCompare(right.keywordId ?? ''))
    .map((row) => {
      const roas = row.spendUsd === 0 ? null : row.netRevenueUsd / row.spendUsd;
      return {
        cohortDate: row.cohortDate,
        cohortWindowDays: input.cohortWindowDays,
        campaignId: row.campaignId,
        adGroupId: row.adGroupId,
        keywordId: row.keywordId,
        spendUsd: roundCurrency(row.spendUsd),
        netRevenueUsd: roundCurrency(row.netRevenueUsd),
        roas: roas === null ? null : roundMetric(roas),
        roasPercent: roas === null ? null : roundMetric(roas * 100),
      };
    });
}

function getOrCreate(
  aggregates: Map<string, AggregatedRow>,
  cohortDate: string,
  row: AppleAdsDimension,
): AggregatedRow {
  const adGroupId = row.adGroupId ?? null;
  const keywordId = row.keywordId ?? null;
  const key = [cohortDate, row.campaignId, adGroupId ?? '', keywordId ?? ''].join('|');
  const existing = aggregates.get(key);
  if (existing) return existing;

  const created: AggregatedRow = {
    cohortDate,
    campaignId: row.campaignId,
    adGroupId,
    keywordId,
    spendUsd: 0,
    netRevenueUsd: 0,
  };
  aggregates.set(key, created);
  return created;
}

function assertDimension(row: AppleAdsDimension): void {
  if (!row.campaignId.trim()) throw new Error('Apple Ads campaignId is required.');
  for (const [name, value] of [
    ['adGroupId', row.adGroupId],
    ['keywordId', row.keywordId],
  ] as const) {
    if (value !== undefined && value !== null && !value.trim()) {
      throw new Error(`Apple Ads ${name} cannot be empty.`);
    }
  }
}

function assertDate(value: string, label: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`${label} must be an ISO date (YYYY-MM-DD).`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} must be an ISO date (YYYY-MM-DD).`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative.`);
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
