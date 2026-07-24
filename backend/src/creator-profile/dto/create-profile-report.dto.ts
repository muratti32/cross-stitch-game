import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import type { ProfileReportReasonCode } from '../entities';

export class CreateProfileReportDto {
  @IsString()
  @IsIn(['impersonation', 'offensive', 'spam', 'other'])
  reasonCode!: ProfileReportReasonCode;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
