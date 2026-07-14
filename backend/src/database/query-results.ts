/**
 * TypeORM's raw `query()` returns `[records, affectedCount]` for UPDATE/DELETE
 * statements on PostgreSQL, but plain records for SELECT/INSERT. This helper
 * normalizes both shapes so callers can treat every RETURNING result as rows.
 */
export function returningRows<T>(result: unknown): readonly T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as readonly T[];
  }
  return result as readonly T[];
}
