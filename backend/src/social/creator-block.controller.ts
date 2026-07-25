import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentPrincipal, JwtAuthGuard, PrincipalType } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { CreatorBlockService } from './creator-block.service';

@Controller('creator-blocks')
@UseGuards(JwtAuthGuard)
export class CreatorBlockController {
  constructor(private readonly creatorBlockService: CreatorBlockService) {}

  @Put(':creatorProfileId')
  async block(
    @Param('creatorProfileId', ParseUUIDPipe) creatorProfileId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('Only registered accounts can block creators');
    }
    return this.creatorBlockService.block(principal.id, creatorProfileId);
  }

  @Delete(':creatorProfileId')
  async unblock(
    @Param('creatorProfileId', ParseUUIDPipe) creatorProfileId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('Only registered accounts can unblock creators');
    }
    return this.creatorBlockService.unblock(principal.id, creatorProfileId);
  }

  @Get()
  async getBlockedCreators(@CurrentPrincipal() principal: AuthPrincipal) {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('Only registered accounts have blocked creators');
    }
    return this.creatorBlockService.getBlockedCreators(principal.id);
  }
}
