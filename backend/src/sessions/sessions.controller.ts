import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth';
import { CurrentPrincipal } from '../auth';
import { AuthPrincipal } from '../auth/auth.types';
import { SessionsService } from './sessions.service';
import { IsUUID } from 'class-validator';

export class PrepareSessionDto {
  @IsUUID()
  patternId!: string;
}

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post('prepare')
  async prepare(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: PrepareSessionDto,
  ) {
    return this.sessionsService.prepareSession(principal, body.patternId);
  }

  @Post(':id/refresh-grant')
  async refreshGrant(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
  ) {
    return this.sessionsService.refreshGrant(principal, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
  ) {
    await this.sessionsService.cancelSession(principal, id);
    return {};
  }
}
