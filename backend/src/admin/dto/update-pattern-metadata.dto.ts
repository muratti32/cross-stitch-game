import { ArrayMaxSize, IsArray, IsString, Length } from 'class-validator';

import { MAX_TAG_CODES_PER_PATTERN } from '../admin.constants';

export class UpdatePatternMetadataDto {
  @IsString()
  @Length(1, 255)
  title!: string;

  @IsString()
  @Length(1, 255)
  creatorName!: string;

  @IsString()
  @Length(1, 64)
  categoryCode!: string;

  @IsArray()
  @ArrayMaxSize(MAX_TAG_CODES_PER_PATTERN)
  @IsString({ each: true })
  tagCodes!: string[];
}
