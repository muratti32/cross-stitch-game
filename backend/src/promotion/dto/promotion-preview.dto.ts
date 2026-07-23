import { IsString, IsUUID, IsNotEmpty, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

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
