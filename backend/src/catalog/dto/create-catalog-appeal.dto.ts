import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCatalogAppealDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
