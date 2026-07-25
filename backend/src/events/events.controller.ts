import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { IngestGameplayEventsDto } from './dto';
import { EventsService, type IngestGameplayEventsResult } from './events.service';

@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  ingest(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: IngestGameplayEventsDto,
  ): Promise<IngestGameplayEventsResult> {
    return this.events.ingest(principal, dto.events);
  }
}
