import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { ProgressCheckpointService } from './progress-checkpoint.service';
import { ProgressSyncService } from './progress-sync.service';
import { CompleteProgressDto, ProgressSyncDto } from './progress-sync.dto';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class ProgressSyncController {
  constructor(
    private readonly progressSyncService: ProgressSyncService,
    private readonly checkpointService: ProgressCheckpointService,
  ) {}

  @Post(':id/progress/sync')
  @HttpCode(HttpStatus.OK)
  async sync(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ProgressSyncDto,
  ) {
    return this.progressSyncService.sync(principal, id, body);
  }

  @Post(':id/progress/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CompleteProgressDto,
  ) {
    return this.progressSyncService.complete(principal, id, body);
  }

  @Get(':id/progress/checkpoint')
  async getCheckpoint(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const checkpoint = await this.checkpointService.getLatestCheckpoint(principal, id);
    if (checkpoint === null) {
      response.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return checkpoint;
  }
}
