import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class PaletteEntryDto {
  @IsString()
  @Length(1, 32)
  dmcCode!: string;

  @IsString()
  @Length(1, 255)
  name!: string;

  @Matches(/^#[0-9A-Fa-f]{6}$/)
  rgbHex!: string;
}

export class CreateDerivedPatternDto {
  @IsUUID()
  patternId!: string;

  @IsUUID()
  sourcePatternId!: string;

  @IsString()
  @Length(1, 255)
  title!: string;

  @IsInt()
  @Min(1)
  @Max(300)
  width!: number;

  @IsInt()
  @Min(1)
  @Max(300)
  height!: number;

  @ValidateNested({ each: true })
  @Type(() => PaletteEntryDto)
  @ArrayMinSize(1)
  palette!: PaletteEntryDto[];

  @IsString()
  grid!: string;
}
