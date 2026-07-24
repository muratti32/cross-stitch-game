import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCatalogMetadataAppealDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
