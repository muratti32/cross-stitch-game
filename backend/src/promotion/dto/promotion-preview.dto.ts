import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { PROMOTION_MODES, PromotionMode } from '../entities';

export class GuestPromotionManifestDto {
  @IsObject()
  progress!: Record<string, { deviceSeq: number; checksum: string }>;

  @IsObject()
  completions!: Record<string, string>; // patternId -> completedAt ISO string

  // reward sourceKey -> evidence. class-validator has no built-in per-value
  // validation for a Record/dictionary (ValidateNested's `each` only iterates
  // arrays), so the evidence shape is intentionally untyped here: the backend
  // never trusts this payload anyway (ADR-0026) — validatePendingReward
  // re-derives everything from the sourceKey and the guest's own server-side
  // records, never from these values.
  @IsObject()
  pendingRewards!: Record<string, unknown>;

  @IsObject()
  likes!: Record<string, boolean>; // patternId -> liked true/false
}

export class PromotionPreviewRequestDto {
  @IsUUID()
  @IsNotEmpty()
  guestId!: string;

  @IsString()
  @IsNotEmpty()
  guestCredential!: string;

  @ValidateNested()
  @Type(() => GuestPromotionManifestDto)
  manifest!: GuestPromotionManifestDto;

  @IsString()
  @IsNotEmpty()
  manifestChecksum!: string;
}

/**
 * The preview the client echoes back to /lock and /commit. Only the signed
 * fields are trusted (verifySignature); the rest are declared so the
 * whitelisting ValidationPipe accepts the full preview the client received.
 */
export class PromotionPreviewDataDto {
  @IsUUID()
  guestId!: string;

  @IsUUID()
  accountId!: string;

  @IsString()
  @IsNotEmpty()
  manifestChecksum!: string;

  @IsIn(PROMOTION_MODES)
  promotionMode!: PromotionMode;

  @IsNumber()
  guestLedgerBalance!: number;

  @IsISO8601()
  expiry!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  validatedPendingRewards?: string[];

  @IsOptional()
  @IsInt()
  guestUnlockCount?: number;

  @IsOptional()
  @IsInt()
  pendingAdAttemptCount?: number;

  @IsOptional()
  @IsObject()
  rejectedPendingRewards?: Record<string, string>;

  @IsOptional()
  @IsObject()
  dispositions?: Record<string, string>;

  @IsOptional()
  @IsString()
  signature?: string;

  @IsOptional()
  @IsIn(['transfer', 'none'])
  paidCommerce?: 'transfer' | 'none';
}
