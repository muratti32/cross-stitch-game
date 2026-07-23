import { IsString, IsObject, IsNotEmpty } from 'class-validator';

export class PromotionCommitRequestDto {
  @IsObject()
  @IsNotEmpty()
  previewData!: any;

  @IsString()
  @IsNotEmpty()
  signature!: string;
}
