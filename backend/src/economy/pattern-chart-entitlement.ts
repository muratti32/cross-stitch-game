import type { EntityManager } from 'typeorm';

import type { PatternChartEntitlementSource } from './entities/pattern-chart-entitlement.entity';

/**
 * Grants the Pattern Chart Entitlement for a finished Official Pattern (ADR-0068).
 * Idempotent; Community and Personal Patterns are never eligible. Returns whether
 * the Pattern is Official, so callers can report that an entitlement now exists.
 */
export async function grantPatternChartEntitlement(
  manager: EntityManager,
  accountId: string,
  patternId: string,
  source: PatternChartEntitlementSource,
): Promise<boolean> {
  const rows = await manager.query<readonly { eligible: boolean }[]>(
    `WITH eligible AS (
       SELECT id FROM catalog.patterns
       WHERE id = $2 AND visibility = 'catalog' AND creator_profile_id IS NULL
     ), granted AS (
       INSERT INTO economy.pattern_chart_entitlements (account_id, pattern_id, source)
       SELECT $1::uuid, id, $3::varchar FROM eligible
       ON CONFLICT ON CONSTRAINT "PK_pattern_chart_entitlements" DO NOTHING
     )
     SELECT EXISTS (SELECT 1 FROM eligible) AS eligible`,
    [accountId, patternId, source],
  );
  return rows[0]?.eligible === true;
}
