import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import type { ConversionProfile } from '../entities';

function optionalInteger(value: unknown): unknown {
  if (value === undefined || value === '') {
    return undefined;
  }
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

export class CreatePhotoConversionDto {
  @IsIn(['easy', 'standard', 'detailed', 'custom'])
  profile!: ConversionProfile;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalInteger(value))
  @IsInt()
  @Min(20)
  @Max(300)
  shortEdgeCells?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalInteger(value))
  @IsInt()
  @Min(5)
  @Max(60)
  maxColors?: number;

  @IsString()
  @Length(1, 255)
  title!: string;
}
