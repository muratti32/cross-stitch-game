import { IsString, IsObject, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { PromotionPreviewDataDto } from './promotion-preview.dto';

export class PromotionCommitRequestDto {
  @IsObject()
  @ValidateNested()
  @Type(() => PromotionPreviewDataDto)
  previewData!: PromotionPreviewDataDto;

  @IsString()
  @IsNotEmpty()
  signature!: string;
}
