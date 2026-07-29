import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const AI_CREDIT_PACK_PRODUCT_KEYS = [
  'ai_credit_pack_5',
  'ai_credit_pack_20',
  'ai_credit_pack_50',
] as const;

export type AiCreditPackProductKey = typeof AI_CREDIT_PACK_PRODUCT_KEYS[number];

export class AiCreditPackReconciliationDto {
  @IsIn(AI_CREDIT_PACK_PRODUCT_KEYS)
  productKey!: AiCreditPackProductKey;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  transactionIdentifier!: string;
}
