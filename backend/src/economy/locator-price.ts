import { ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** The operator-managed Locator Price is a whole Stitch Coin amount in this range (ADR-0060). */
export const LOCATOR_PRICE_MIN_COIN = 1;
export const LOCATOR_PRICE_MAX_COIN = 10;

export interface LocatorPriceSetting {
  price: number;
  updatedAt: string;
  updatedByOperatorId: string | null;
}

interface LocatorPriceRow {
  price_coin: number;
  updated_at: Date | string;
  updated_by_operator_id: string | null;
}

export type LocatorPriceLock = 'none' | 'share' | 'update';

/**
 * Reads the single global Locator Price. A missing or out-of-range row never
 * degrades into a free locator: callers receive a 503 instead (ADR-0060).
 */
export async function readLocatorPrice(
  manager: EntityManager,
  lock: LocatorPriceLock = 'none',
): Promise<LocatorPriceSetting> {
  const clause = lock === 'update' ? ' FOR UPDATE' : lock === 'share' ? ' FOR SHARE' : '';
  const rows = await manager.query<readonly LocatorPriceRow[]>(
    `SELECT price_coin, updated_at, updated_by_operator_id
     FROM economy.locator_price_setting WHERE id = 1${clause}`,
  );
  const row = rows[0];
  const price = Number(row?.price_coin);
  if (!row || !isValidLocatorPrice(price)) {
    throw new ServiceUnavailableException({ code: 'locator_price_unavailable' });
  }
  return {
    price,
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedByOperatorId: row.updated_by_operator_id,
  };
}

export function isValidLocatorPrice(value: number): boolean {
  return Number.isSafeInteger(value) && value >= LOCATOR_PRICE_MIN_COIN && value <= LOCATOR_PRICE_MAX_COIN;
}
