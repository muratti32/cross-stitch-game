import { IsString, IsUUID, IsNotEmpty, IsObject } from 'class-validator';

export class PromotionPackageRequestDto {
  @IsUUID()
  @IsNotEmpty()
  guestId!: string;

  @IsUUID()
  @IsNotEmpty()
  lockToken!: string;

  @IsString()
  @IsNotEmpty()
  manifestChecksum!: string;

  @IsObject()
  packageData!: any;

  @IsString()
  @IsNotEmpty()
  checksum!: string;
}
