import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const COIN_PACK_PRODUCT_KEYS = [
  'coin_pack_300',
  'coin_pack_900',
  'coin_pack_2000',
] as const;

export type CoinPackProductKey = typeof COIN_PACK_PRODUCT_KEYS[number];

export class CoinPackReconciliationDto {
  @IsIn(COIN_PACK_PRODUCT_KEYS)
  productKey!: CoinPackProductKey;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  transactionIdentifier!: string;
}
