import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { IsUUID, IsNotEmpty } from 'class-validator';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { PromotionService } from './promotion.service';
import { PromotionPreviewRequestDto } from './dto/promotion-preview.dto';
import { PromotionLockRequestDto } from './dto/promotion-lock.dto';
import { PromotionPackageRequestDto } from './dto/promotion-package.dto';

class PromotionCancelRequestDto {
  @IsUUID()
  @IsNotEmpty()
  guestId!: string;
}

@Controller('promotion')
@UseGuards(JwtAuthGuard)
export class PromotionController {
  constructor(private readonly promotionService: PromotionService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  async preview(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: PromotionPreviewRequestDto,
  ) {
    return this.promotionService.generatePreview(principal.id, dto);
  }

  @Post('lock')
  @HttpCode(HttpStatus.OK)
  async lock(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: PromotionLockRequestDto,
  ) {
    return this.promotionService.acquireLock(
      principal.id,
      dto.signature,
      dto.previewData,
    );
  }

  @Post('stage-package')
  @HttpCode(HttpStatus.OK)
  async stagePackage(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: PromotionPackageRequestDto,
  ) {
    return this.promotionService.stagePackage(principal.id, dto);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: PromotionCancelRequestDto,
  ) {
    return this.promotionService.cancelPromotion(principal.id, dto.guestId);
  }
}
