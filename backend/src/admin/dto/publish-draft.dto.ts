import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsString,
  Length,
} from 'class-validator';

import { MAX_TAG_CODES_PER_PATTERN } from '../admin.constants';

function toBoolean(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

export class PublishDraftDto {
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

  @Transform(({ value }: { value: unknown }) => toBoolean(value))
  @IsBoolean()
  paid!: boolean;
}
