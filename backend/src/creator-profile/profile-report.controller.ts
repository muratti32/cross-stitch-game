import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { CreateProfileReportDto } from './dto/create-profile-report.dto';
import { ProfileReportService } from './profile-report.service';

@Controller('creator-profiles')
export class ProfileReportController {
  constructor(private readonly reports: ProfileReportService) {}

  @Post(':id/reports')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  report(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProfileReportDto,
  ) {
    return this.reports.report(principal, id, dto);
  }
}
