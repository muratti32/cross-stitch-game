import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsUUID,
} from 'class-validator';

export class BulkSetPatternsPaidDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  patternIds!: string[];

  @IsBoolean()
  paid!: boolean;
}
