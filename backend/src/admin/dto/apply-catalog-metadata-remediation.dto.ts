import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ApplyCatalogMetadataRemediationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;

  @IsArray()
  @IsString({ each: true })
  removeTagCodes!: string[];

  @IsOptional()
  @IsString()
  categoryCode?: string;
}
