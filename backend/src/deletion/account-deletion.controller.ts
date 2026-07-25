import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { AccountDeletionService } from './account-deletion.service';
import { RequestAccountDeletionDto } from './dto/request-account-deletion.dto';

@Controller('account/deletion')
@UseGuards(JwtAuthGuard)
export class AccountDeletionController {
  constructor(private readonly accountDeletionService: AccountDeletionService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async request(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: RequestAccountDeletionDto,
  ) {
    void dto;
    return this.accountDeletionService.request(principal);
  }

  @Get()
  async getStatus(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.accountDeletionService.getStatus(principal);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.accountDeletionService.cancel(principal);
  }
}
