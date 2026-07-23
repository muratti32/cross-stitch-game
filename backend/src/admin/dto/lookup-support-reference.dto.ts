import { IsString, MaxLength, MinLength } from 'class-validator';

export class LookupSupportReferenceDto {
  @IsString()
  @MinLength(10)
  @MaxLength(24)
  code!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
