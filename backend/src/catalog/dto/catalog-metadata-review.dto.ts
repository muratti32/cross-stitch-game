import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class AcceptCatalogMetadataRevisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class RejectCatalogMetadataRevisionDto {
  @IsString()
  @IsIn([
    'safety',
    'publication_rights',
    'duplicate_or_spam',
    'technical_invalidity',
    'quality_standard',
  ])
  reason!:
    | 'safety'
    | 'publication_rights'
    | 'duplicate_or_spam'
    | 'technical_invalidity'
    | 'quality_standard';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
