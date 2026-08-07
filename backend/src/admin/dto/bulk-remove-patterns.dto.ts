import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class BulkRemovePatternsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  patternIds!: string[];

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(10, 2000)
  reason!: string;

  @IsUUID('4')
  batchId!: string;
}
