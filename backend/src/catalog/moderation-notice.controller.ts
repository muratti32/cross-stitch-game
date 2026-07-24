import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { ModerationNoticeService } from './moderation-notice.service';

@Controller('moderation-notices')
@UseGuards(JwtAuthGuard)
export class ModerationNoticeController {
  constructor(private readonly notices: ModerationNoticeService) {}

  @Get()
  listMine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.notices.listMine(principal);
  }
}
