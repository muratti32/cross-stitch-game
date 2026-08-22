import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const GUEST_COIN_PACK_PRODUCT_IDS = [
  'com.avk.stitchwish.coin_pack_300',
  'com.avk.stitchwish.coin_pack_900',
  'com.avk.stitchwish.coin_pack_2000',
] as const;

export class GuestSubscriberMappingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  subscriberId!: string;
}

export class GuestPurchaseAttemptDto {
  @IsIn(GUEST_COIN_PACK_PRODUCT_IDS)
  productId!: typeof GUEST_COIN_PACK_PRODUCT_IDS[number];

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  subscriberId!: string;
}
