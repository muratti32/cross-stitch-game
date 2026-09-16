import { createHash } from 'node:crypto';

import type { PatternUnlockPriceTier } from '../../catalog/entities';
import { deriveUnlockPriceTier } from '../pattern-price-tier';

export const PAID_PATTERN_SELECTION_ALGORITHM = 'paid-pattern-selection/v1' as const;

export interface PaidPatternCandidate {
  id: string;
  title: string;
  categoryCode: string;
  status: string;
  patternType: 'official' | 'community';
  unlockPriceTier: PatternUnlockPriceTier;
  stitchableCellCount: number | null;
}

export interface PaidPatternSelectionRules {
  paidPerCategory: number;
  minSmallPaid: number;
  maxSmallPaid: number;
  maxAttempts: number;
}

export interface PaidPatternSelectionResult {
  algorithm: typeof PAID_PATTERN_SELECTION_ALGORITHM;
  seed: string;
  attempt: number;
  rules: PaidPatternSelectionRules;
  totalPaid: number;
  selectedPatternIds: string[];
  selected: Array<{
    id: string;
    title: string;
    categoryCode: string;
    tier: Exclude<PatternUnlockPriceTier, null>;
    staffPick: boolean;
    currentTier: PatternUnlockPriceTier;
  }>;
  perCategory: Array<{
    categoryCode: string;
    eligible: number;
    usable: number;
    excluded: number;
    paid: number;
    free: number;
  }>;
  perTier: { small: number; medium: number; large: number };
  staffPicks: { usable: number; paid: number; maxPaid: number };
  excluded: Array<{
    id: string;
    title: string;
    categoryCode: string;
    reason: PaidPatternExclusionReason;
  }>;
  warnings: { currentlyPaidNotSelected: string[] };
  selectionDigest: string;
}

export type PaidPatternExclusionReason =
  | 'stitchable_cell_count_unknown'
  | 'pattern_id_not_uuid_v4';

export type PaidPatternSelectionErrorCode =
  | 'empty_seed'
  | 'invalid_rules'
  | 'category_too_small'
  | 'constraints_unsatisfied'
  | 'selection_size_mismatch';

export class PaidPatternSelectionError extends Error {
  constructor(
    public readonly code: PaidPatternSelectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaidPatternSelectionError';
  }
}

const DEFAULT_RULES: PaidPatternSelectionRules = {
  paidPerCategory: 6,
  minSmallPaid: 6,
  maxSmallPaid: 10,
  maxAttempts: 10_000,
};

type UsableCandidate = PaidPatternCandidate & {
  id: string;
  tier: Exclude<PatternUnlockPriceTier, null>;
  staffPick: boolean;
};

export function selectPaidPatterns(input: {
  candidates: PaidPatternCandidate[];
  staffPickPatternIds: string[];
  seed: string;
  rules?: Partial<PaidPatternSelectionRules>;
}): PaidPatternSelectionResult {
  if (input.seed.trim().length === 0) {
    throw new PaidPatternSelectionError('empty_seed', 'Selection seed must not be empty');
  }
  const rules = { ...DEFAULT_RULES, ...input.rules };
  validateRules(rules);

  const staffPickIds = new Set(input.staffPickPatternIds.map((id) => id.toLowerCase()));
  const eligible = input.candidates
    .filter((candidate) =>
      candidate.patternType === 'official' && candidate.status === 'available',
    )
    .map((candidate) => ({ ...candidate, id: candidate.id.toLowerCase() }))
    .sort(compareCategoryThenId);
  const excluded = eligible.flatMap((candidate) => {
    const reason = exclusionReason(candidate);
    return reason === null
      ? []
      : [{
          categoryCode: candidate.categoryCode,
          id: candidate.id,
          reason,
          title: candidate.title,
        }];
  });
  const usable: UsableCandidate[] = eligible.flatMap((candidate) => {
    if (exclusionReason(candidate) !== null || candidate.stitchableCellCount === null) {
      return [];
    }
    const tier = deriveUnlockPriceTier(true, candidate.stitchableCellCount);
    if (tier === null) {
      throw new Error('Paid tier derivation returned no tier');
    }
    return [{
      ...candidate,
      staffPick: staffPickIds.has(candidate.id),
      tier,
    }];
  });
  // The categories come from the eligible set, not from `usable`: a category
  // whose Patterns are all excluded would otherwise vanish from the map and
  // silently shrink the rollout below `paidPerCategory * categories`.
  const usableByCategory = groupByCategory(usable);
  const byCategory = new Map<string, UsableCandidate[]>(
    [...new Set(eligible.map((candidate) => candidate.categoryCode))]
      .sort(compareStrings)
      .map((categoryCode) => [categoryCode, usableByCategory.get(categoryCode) ?? []]),
  );
  for (const [categoryCode, candidates] of byCategory) {
    if (candidates.length < rules.paidPerCategory) {
      throw new PaidPatternSelectionError(
        'category_too_small',
        `Category ${categoryCode} has ${candidates.length} usable candidates; requires ${rules.paidPerCategory}`,
      );
    }
  }

  const usableStaffPicks = usable.filter((candidate) => candidate.staffPick).length;
  const maxStaffPicksPaid = Math.floor(usableStaffPicks / 2);
  let accepted: { attempt: number; selected: UsableCandidate[] } | null = null;
  let best: { small: number; staffPicks: number; score: number } | null = null;
  for (let attempt = 0; attempt < rules.maxAttempts; attempt += 1) {
    const selected = [...byCategory.entries()].flatMap(([, candidates]) =>
      [...candidates]
        .sort((left, right) => compareRank(input.seed, attempt, left.id, right.id))
        .slice(0, rules.paidPerCategory),
    );
    const small = selected.filter((candidate) => candidate.tier === 'small').length;
    const paidStaffPicks = selected.filter((candidate) => candidate.staffPick).length;
    const score = rangeDistance(small, rules.minSmallPaid, rules.maxSmallPaid)
      + Math.max(0, paidStaffPicks - maxStaffPicksPaid);
    if (best === null || score < best.score) {
      best = { score, small, staffPicks: paidStaffPicks };
    }
    if (
      small >= rules.minSmallPaid
      && small <= rules.maxSmallPaid
      && paidStaffPicks <= maxStaffPicksPaid
    ) {
      accepted = { attempt, selected };
      break;
    }
  }
  if (accepted === null) {
    throw new PaidPatternSelectionError(
      'constraints_unsatisfied',
      `No selection satisfied constraints after ${rules.maxAttempts} attempts; best small paid=${best?.small ?? 0}, staff picks paid=${best?.staffPicks ?? 0}`,
    );
  }

  const selectedPatternIds = accepted.selected.map((candidate) => candidate.id).sort();
  const expectedPaid = rules.paidPerCategory * byCategory.size;
  if (selectedPatternIds.length !== expectedPaid) {
    throw new PaidPatternSelectionError(
      'selection_size_mismatch',
      `Selection produced ${selectedPatternIds.length} Patterns; expected ${expectedPaid}`,
    );
  }
  const selectedIds = new Set(selectedPatternIds);
  const selected = accepted.selected
    .map((candidate) => ({
      categoryCode: candidate.categoryCode,
      currentTier: candidate.unlockPriceTier,
      id: candidate.id,
      staffPick: candidate.staffPick,
      tier: candidate.tier,
      title: candidate.title,
    }))
    .sort(compareCategoryThenId);
  const perTier = {
    large: selected.filter((candidate) => candidate.tier === 'large').length,
    medium: selected.filter((candidate) => candidate.tier === 'medium').length,
    small: selected.filter((candidate) => candidate.tier === 'small').length,
  };
  const paidStaffPicks = selected.filter((candidate) => candidate.staffPick).length;
  const selectionDigest = sha256(
    `${PAID_PATTERN_SELECTION_ALGORITHM}\n${input.seed}\n${selectedPatternIds.join(',')}`,
  );

  // `free` counts every eligible Pattern that stays free, excluded ones
  // included, because that is the number #260's "6 paid, 13 free" refers to.
  const eligibleByCategory = new Map<string, number>();
  for (const candidate of eligible) {
    eligibleByCategory.set(
      candidate.categoryCode,
      (eligibleByCategory.get(candidate.categoryCode) ?? 0) + 1,
    );
  }

  return {
    algorithm: PAID_PATTERN_SELECTION_ALGORITHM,
    attempt: accepted.attempt,
    excluded,
    perCategory: [...byCategory.entries()].map(([categoryCode, candidates]) => {
      const eligibleCount = eligibleByCategory.get(categoryCode) ?? 0;
      return {
        categoryCode,
        eligible: eligibleCount,
        excluded: eligibleCount - candidates.length,
        free: eligibleCount - rules.paidPerCategory,
        paid: rules.paidPerCategory,
        usable: candidates.length,
      };
    }),
    perTier,
    rules,
    seed: input.seed,
    selected,
    selectedPatternIds,
    selectionDigest,
    staffPicks: {
      maxPaid: maxStaffPicksPaid,
      paid: paidStaffPicks,
      usable: usableStaffPicks,
    },
    totalPaid: selected.length,
    warnings: {
      currentlyPaidNotSelected: usable
        .filter((candidate) =>
          candidate.unlockPriceTier !== null && !selectedIds.has(candidate.id),
        )
        .map((candidate) => candidate.id)
        .sort(),
    },
  };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The bulk-paid endpoint validates `@IsUUID('4', { each: true })` and rejects a
// whole 50-Pattern batch over one malformed id, so an unusable id is excluded
// here and shown in the dry-run instead of surfacing mid-apply.
function exclusionReason(
  candidate: PaidPatternCandidate,
): PaidPatternExclusionReason | null {
  if (!UUID_V4.test(candidate.id)) {
    return 'pattern_id_not_uuid_v4';
  }
  if (candidate.stitchableCellCount === null || candidate.stitchableCellCount < 1) {
    return 'stitchable_cell_count_unknown';
  }
  return null;
}

function validateRules(rules: PaidPatternSelectionRules): void {
  const values = [
    rules.paidPerCategory,
    rules.minSmallPaid,
    rules.maxSmallPaid,
    rules.maxAttempts,
  ];
  if (
    values.some((value) => !Number.isSafeInteger(value) || value <= 0)
    || rules.minSmallPaid > rules.maxSmallPaid
  ) {
    throw new PaidPatternSelectionError(
      'invalid_rules',
      'Selection rules must be positive integers and minSmallPaid must not exceed maxSmallPaid',
    );
  }
}

function groupByCategory(
  candidates: UsableCandidate[],
): Map<string, UsableCandidate[]> {
  const grouped = new Map<string, UsableCandidate[]>();
  for (const candidate of candidates) {
    const current = grouped.get(candidate.categoryCode) ?? [];
    current.push(candidate);
    grouped.set(candidate.categoryCode, current);
  }
  return new Map([...grouped.entries()].sort(([left], [right]) => compareStrings(left, right)));
}

// Plain code-unit ordering, never `localeCompare`: the selection must be
// identical on every machine that runs it, and ICU collation is not.
function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareRank(seed: string, attempt: number, leftId: string, rightId: string): number {
  const leftRank = sha256(`${seed}:${attempt}:${leftId}`);
  const rightRank = sha256(`${seed}:${attempt}:${rightId}`);
  return compareStrings(leftRank, rightRank) || compareStrings(leftId, rightId);
}

function compareCategoryThenId(
  left: { categoryCode: string; id: string },
  right: { categoryCode: string; id: string },
): number {
  return compareStrings(left.categoryCode, right.categoryCode)
    || compareStrings(left.id, right.id);
}

function rangeDistance(value: number, minimum: number, maximum: number): number {
  if (value < minimum) return minimum - value;
  if (value > maximum) return value - maximum;
  return 0;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
