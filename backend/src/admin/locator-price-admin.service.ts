import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  isValidLocatorPrice,
  LOCATOR_PRICE_MAX_COIN,
  LOCATOR_PRICE_MIN_COIN,
  readLocatorPrice,
} from '../economy/locator-price';
import { OperatorAuditLogService } from './operator-audit-log.service';

export interface LocatorPriceAdminView {
  price: number;
  minPrice: number;
  maxPrice: number;
  updatedAt: string;
  updatedByOperatorId: string | null;
}

@Injectable()
export class LocatorPriceAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditLog: OperatorAuditLogService,
  ) {}

  async get(): Promise<LocatorPriceAdminView> {
    return toView(await readLocatorPrice(this.dataSource.manager));
  }

  /**
   * Changes the global Locator Price with immediate effect. The row lock
   * waits for in-flight reservations holding FOR SHARE, and the audit row
   * commits atomically with the change (ADR-0060).
   */
  async update(operatorAccountId: string, price: number, requestId: string | null): Promise<LocatorPriceAdminView> {
    if (!isValidLocatorPrice(price)) {
      throw new BadRequestException(`price must be a whole number from ${LOCATOR_PRICE_MIN_COIN} to ${LOCATOR_PRICE_MAX_COIN}`);
    }
    return this.dataSource.transaction(async (manager) => {
      const before = await readLocatorPrice(manager, 'update');
      if (before.price === price) return toView(before);

      await manager.query(
        `UPDATE economy.locator_price_setting
         SET price_coin = $1, updated_by_operator_id = $2, updated_at = now()
         WHERE id = 1`,
        [price, operatorAccountId],
      );
      const after = await readLocatorPrice(manager);
      await this.auditLog.record(manager, {
        action: 'economy.locator_price.update',
        after: { price: after.price },
        before: { price: before.price },
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: 'locator_price',
        targetType: 'economy_setting',
      });
      return toView(after);
    });
  }
}

function toView(setting: { price: number; updatedAt: string; updatedByOperatorId: string | null }): LocatorPriceAdminView {
  return {
    price: setting.price,
    minPrice: LOCATOR_PRICE_MIN_COIN,
    maxPrice: LOCATOR_PRICE_MAX_COIN,
    updatedAt: setting.updatedAt,
    updatedByOperatorId: setting.updatedByOperatorId,
  };
}
