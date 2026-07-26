import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  COMMUNITY_REPORT_REASONS,
  type CommunityReportReason,
} from '../entities/community-report.entity';

export class CreateCommunityReportDto {
  @IsIn(COMMUNITY_REPORT_REASONS)
  reason!: CommunityReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  explanation?: string;
}
