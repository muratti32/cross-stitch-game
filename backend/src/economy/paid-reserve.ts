export interface PaidReserveState {
  balance: number;
  paidBalance: number;
}

/** Applies one ledger mutation using free value before paid value. */
export function applyPaidReserveMutation(
  state: PaidReserveState,
  amount: number,
  paidMint: boolean,
  paidReversal: boolean,
): PaidReserveState {
  if (paidMint && amount > 0) {
    return { balance: state.balance + amount, paidBalance: state.paidBalance + amount };
  }
  if (paidReversal && amount < 0) {
    return {
      balance: state.balance + amount,
      paidBalance: Math.max(0, state.paidBalance - Math.min(state.paidBalance, -amount)),
    };
  }
  if (amount < 0) {
    const debit = -amount;
    const free = Math.max(0, state.balance - state.paidBalance);
    return {
      balance: state.balance + amount,
      paidBalance: Math.max(0, state.paidBalance - Math.max(0, debit - free)),
    };
  }
  return { balance: state.balance + amount, paidBalance: state.paidBalance };
}

/** Shared locked-row SQL expression used by every consumable debit path. */
export function paidDebitUpdateExpression(alias: string): string {
  return `GREATEST(0, ${alias}.paid_balance - GREATEST(0, -EXCLUDED.balance - GREATEST(0, ${alias}.balance - ${alias}.paid_balance)))`;
}
