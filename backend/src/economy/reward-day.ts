// Reward Days begin at 00:00 UTC (ADR-0011). The server owns the boundary; the
// client only displays the remaining time and never infers reset from device
// time.

/** The UTC calendar date (`YYYY-MM-DD`) of the given instant. */
export function utcRewardDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** The next 00:00 UTC boundary strictly after the given instant. */
export function nextRewardDayResetAt(at: Date = new Date()): Date {
  const next = new Date(at);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
