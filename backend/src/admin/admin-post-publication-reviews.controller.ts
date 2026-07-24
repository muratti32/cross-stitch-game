import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentOperator } from './current-operator.decorator';
import { ApplyReviewHoldDto } from './dto/apply-review-hold.dto';
import { OperatorAuthGuard } from './operator-auth.guard';
import type { OperatorPrincipal } from './operator-auth.types';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { PostPublicationReviewService } from './post-publication-review.service';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/post-publication-reviews')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminPostPublicationReviewsController {
  constructor(private readonly reviews: PostPublicationReviewService) {}

  @Get()
  @RequireOperatorPermissions('catalog.post_publication_review.manage')
  list() {
    return this.reviews.listOpen();
  }

  @Get(':id')
  @RequireOperatorPermissions('catalog.post_publication_review.manage')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.get(id);
  }

  @Post(':id/hold')
  @RequireOperatorPermissions('catalog.post_publication_review.manage')
  applyHold(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyReviewHoldDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.reviews.applyHold(
      operator.id,
      id,
      dto.reason,
      requestId ?? null,
    );
  }
}
