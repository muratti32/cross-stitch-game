import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

import { TagLabelInputDto } from './tag-label-input.dto';

export class CreateTagDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'code must be lowercase letters, digits, and hyphens only',
  })
  code!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TagLabelInputDto)
  labels!: TagLabelInputDto[];
}
