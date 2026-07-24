import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { CommunityReportService } from './community-report.service';
import { CreateCommunityReportDto } from './dto/create-community-report.dto';

@Controller('catalog/patterns')
@UseGuards(JwtAuthGuard)
export class CommunityReportController {
  constructor(private readonly reports: CommunityReportService) {}

  @Post(':patternId/reports')
  @HttpCode(200)
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: CreateCommunityReportDto,
  ) {
    return this.reports.create(principal, patternId, dto);
  }
}
