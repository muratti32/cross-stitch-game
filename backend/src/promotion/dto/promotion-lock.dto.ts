import { IsString, IsNotEmpty, IsObject } from 'class-validator';

export class PromotionLockRequestDto {
  @IsObject()
  @IsNotEmpty()
  previewData!: any;

  @IsString()
  @IsNotEmpty()
  signature!: string;
}
