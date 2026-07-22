import { IsString, IsUUID, IsNotEmpty, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class GuestPromotionManifestDto {
  @IsObject()
  progress!: Record<string, { deviceSeq: number; checksum: string }>;

  @IsObject()
  completions!: Record<string, string>; // patternId -> completedAt ISO string

  @IsObject()
  pendingRewards!: Record<string, any>; // reward sourceKey -> evidence

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
