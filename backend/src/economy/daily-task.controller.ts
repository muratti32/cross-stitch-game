import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { IngestEventsDto } from './daily-task.dto';
import { DailyTaskBoardView, DailyTaskService } from './daily-task.service';

@Controller('economy/daily-tasks')
@UseGuards(JwtAuthGuard)
export class DailyTaskController {
  constructor(private readonly dailyTasks: DailyTaskService) {}

  @Get()
  getBoard(@CurrentPrincipal() principal: AuthPrincipal): Promise<DailyTaskBoardView> {
    return this.dailyTasks.getBoard(principal);
  }

  @Post('events')
  ingest(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: IngestEventsDto,
  ): Promise<DailyTaskBoardView> {
    return this.dailyTasks.ingest(principal, dto.events);
  }
}
