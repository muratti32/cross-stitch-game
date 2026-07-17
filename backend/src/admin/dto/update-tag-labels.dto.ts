import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';

import { TagLabelInputDto } from './tag-label-input.dto';

export class UpdateTagLabelsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TagLabelInputDto)
  labels!: TagLabelInputDto[];
}
