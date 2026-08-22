/** Shared locked-row SQL expression used by every consumable debit path. */
export function paidDebitUpdateExpression(alias: string): string {
  return `GREATEST(0, ${alias}.paid_balance - GREATEST(0, -EXCLUDED.balance - GREATEST(0, ${alias}.balance - ${alias}.paid_balance)))`;
}
