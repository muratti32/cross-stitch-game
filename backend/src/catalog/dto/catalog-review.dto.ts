import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class AcceptCatalogSubmissionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class RejectCatalogSubmissionDto {
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
