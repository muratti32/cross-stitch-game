import { Check, Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Singleton row holding the operator-managed Locator Price (ADR-0060). */
@Entity({ name: 'locator_price_setting', schema: 'economy' })
@Check('CHK_locator_price_setting_singleton', '"id" = 1')
@Check('CHK_locator_price_setting_price', '"price_coin" BETWEEN 1 AND 10')
export class LocatorPriceSettingEntity {
  @PrimaryColumn({ type: 'smallint' })
  id!: number;

  @Column({ name: 'price_coin', type: 'integer' })
  priceCoin!: number;

  @Column({ name: 'updated_by_operator_id', type: 'uuid', nullable: true })
  updatedByOperatorId!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
