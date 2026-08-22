import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { PREMIUM_PRODUCT_CATALOG } from './membership.constants';
import { COMMERCE_PRODUCT_CATALOG } from './commerce.constants';

export const GUEST_COIN_PACK_PRODUCT_IDS = [
  'com.avk.stitchwish.coin_pack_300',
  'com.avk.stitchwish.coin_pack_900',
  'com.avk.stitchwish.coin_pack_2000',
] as const;
export const GUEST_PREMIUM_PRODUCT_IDS = Object.keys(PREMIUM_PRODUCT_CATALOG) as Array<keyof typeof PREMIUM_PRODUCT_CATALOG>;
type CommerceProductId = keyof typeof COMMERCE_PRODUCT_CATALOG;
type AiCreditProductId = {
  [ProductId in CommerceProductId]: (typeof COMMERCE_PRODUCT_CATALOG)[ProductId]['currency'] extends 'ai_credit'
    ? ProductId
    : never;
}[CommerceProductId];

// Keep this tuple explicitly typed from the catalog's currency, not its
// spelling, so renaming a product cannot silently remove it from Guest commerce.
export const GUEST_AI_CREDIT_PACK_PRODUCT_IDS = [
  'com.avk.stitchwish.ai_credit_pack_5',
  'com.avk.stitchwish.ai_credit_pack_20',
  'com.avk.stitchwish.ai_credit_pack_50',
] as const satisfies readonly AiCreditProductId[];
export const GUEST_PURCHASABLE_PRODUCT_IDS = [
  ...GUEST_COIN_PACK_PRODUCT_IDS,
  ...GUEST_PREMIUM_PRODUCT_IDS,
  ...GUEST_AI_CREDIT_PACK_PRODUCT_IDS,
] as const;

export class GuestSubscriberMappingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  subscriberId!: string;
}

export class GuestPurchaseAttemptDto {
  @IsIn(GUEST_PURCHASABLE_PRODUCT_IDS)
  productId!: typeof GUEST_PURCHASABLE_PRODUCT_IDS[number];

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  subscriberId!: string;
}
