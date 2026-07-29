import { IsIn, IsOptional } from 'class-validator';

const PREMIUM_PRODUCT_KEYS = [
  'premium_weekly',
  'premium_monthly',
  'premium_annual',
] as const;

export class PremiumReconciliationDto {
  @IsIn(['purchase', 'restore'])
  operation!: 'purchase' | 'restore';

  @IsOptional()
  @IsIn(PREMIUM_PRODUCT_KEYS)
  productKey!: typeof PREMIUM_PRODUCT_KEYS[number] | null;
}
