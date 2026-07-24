import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsString, Length, Matches } from 'class-validator';

export class CreateCatalogMetadataRevisionDto {
  @IsString()
  @Length(1, 120)
  title!: string;

  @IsString()
  @Length(1, 2000)
  description!: string;

  @IsString()
  @IsIn(['en'])
  sourceLanguage!: string;

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,63}$/)
  categoryCode!: string;

  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z0-9][a-z0-9-]{0,63}$/, { each: true })
  tagCodes!: string[];
}
