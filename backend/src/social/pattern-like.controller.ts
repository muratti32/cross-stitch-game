import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPrincipal, JwtAuthGuard, PrincipalType } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { PatternLikeService } from './pattern-like.service';

@Controller()
export class PatternLikeController {
  constructor(private readonly patternLikeService: PatternLikeService) {}

  @Put('patterns/:id/like')
  @UseGuards(JwtAuthGuard)
  async like(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('Only registered accounts can like patterns');
    }
    return this.patternLikeService.like(principal.id, id);
  }

  @Delete('patterns/:id/like')
  @UseGuards(JwtAuthGuard)
  async unlike(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('Only registered accounts can unlike patterns');
    }
    return this.patternLikeService.unlike(principal.id, id);
  }

  @Get('me/liked-patterns')
  @UseGuards(JwtAuthGuard)
  async getLikedPatterns(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('locale') locale?: string,
  ) {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('Only registered accounts have liked patterns');
    }
    const parsedLimit = parseInt(limit || '10', 10);
    return this.patternLikeService.getLikedPatterns(principal.id, {
      cursor,
      limit: parsedLimit,
      locale: locale || 'en',
    });
  }
}
