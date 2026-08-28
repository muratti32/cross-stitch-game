/**
 * Number and date formatting bound to the active App Display Language.
 * Backed by the platform `Intl` APIs per #155's Implementation Decisions.
 *
 * Store prices are the one documented exception: a price string comes from
 * the purchases SDK already formatted and localized for the player's store
 * account (ADR-0032), and must be rendered exactly as received. Never pass a
 * store price through these helpers.
 */

/** Formats a number (e.g. a Stitch Coin balance or a progress percentage). */
export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/** Formats a date or timestamp (e.g. a recovery-window end date). */
export function formatDate(
  date: Date,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(date);
}
