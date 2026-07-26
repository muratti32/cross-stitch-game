import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { OFFICIAL_PATTERN_DRAFT_MAX_UPLOAD_BYTES } from './admin.constants';
import { CurrentOperator } from './current-operator.decorator';
import { CreatePatternDraftDto } from './dto/create-pattern-draft.dto';
import { PublishDraftDto } from './dto/publish-draft.dto';
import { OfficialPatternDraftStatus } from './entities';
import { OfficialPatternDraftsService, UploadedSourceImage } from './official-pattern-drafts.service';
import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { OperatorPrincipal } from './operator-auth.types';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

const KNOWN_STATUSES: readonly OfficialPatternDraftStatus[] = [
  OfficialPatternDraftStatus.Pending,
  OfficialPatternDraftStatus.Processing,
  OfficialPatternDraftStatus.Ready,
  OfficialPatternDraftStatus.Failed,
  OfficialPatternDraftStatus.Published,
  OfficialPatternDraftStatus.Discarded,
];

@Controller('admin/pattern-drafts')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class OfficialPatternDraftsController {
  constructor(private readonly drafts: OfficialPatternDraftsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireOperatorPermissions('catalog.pattern.publish')
  @UseInterceptors(
    FileInterceptor('sourceImage', {
      fileFilter: (_request, file, callback) => {
        if (file.mimetype !== 'image/jpeg' && file.mimetype !== 'image/png') {
          callback(new BadRequestException('Source image must be JPEG or PNG'), false);
          return;
        }
        callback(null, true);
      },
      limits: {
        fieldSize: 1024,
        fields: 4,
        fileSize: OFFICIAL_PATTERN_DRAFT_MAX_UPLOAD_BYTES,
        files: 1,
      },
    }),
  )
  create(
    @CurrentOperator() operator: OperatorPrincipal,
    @Body() body: CreatePatternDraftDto,
    @UploadedFile() sourceImage: UploadedSourceImage | undefined,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.drafts.createDraft(operator.id, body, sourceImage, requestId ?? null);
  }

  @Get()
  @RequireOperatorPermissions('catalog.pattern.read')
  list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.drafts.listDrafts({
      page: parsePositiveInt(page, 1),
      pageSize: Math.min(parsePositiveInt(pageSize, 20), 100),
      status: parseStatus(status),
    });
  }

  @Get(':id')
  @RequireOperatorPermissions('catalog.pattern.read')
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.drafts.getDraftById(id);
  }

  @Get(':id/preview')
  @RequireOperatorPermissions('catalog.pattern.read')
  async getPreview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const bytes = await this.drafts.getPreviewBytes(id);
    response.setHeader('Cache-Control', 'private, max-age=60');
    response.setHeader('Content-Type', 'image/png');
    response.send(bytes);
  }

  @Get(':id/thumbnail/:variant')
  @RequireOperatorPermissions('catalog.pattern.read')
  async getThumbnail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('variant') variant: string,
    @Res() response: Response,
  ): Promise<void> {
    if (variant !== 'browsing' && variant !== 'detail') {
      throw new BadRequestException(`Invalid Pattern Thumbnail variant: ${variant}`);
    }
    const bytes = await this.drafts.getThumbnailBytes(id, variant);
    response.setHeader('Cache-Control', 'private, max-age=60');
    response.setHeader('Content-Type', 'image/png');
    response.send(bytes);
  }

  @Post(':id/publish')
  @RequireOperatorPermissions('catalog.pattern.publish')
  publish(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PublishDraftDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.drafts.publishDraft(operator.id, id, body, requestId ?? null);
  }

  @Post(':id/discard')
  @RequireOperatorPermissions('catalog.pattern.publish')
  discard(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.drafts.discardDraft(operator.id, id, requestId ?? null);
  }
}

function parseStatus(status: string | undefined): OfficialPatternDraftStatus | undefined {
  if (status === undefined || status === '') {
    return undefined;
  }
  if (!KNOWN_STATUSES.includes(status as OfficialPatternDraftStatus)) {
    throw new BadRequestException(`Invalid status filter: ${status}`);
  }
  return status as OfficialPatternDraftStatus;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException(`Invalid numeric parameter: ${value}`);
  }
  return parsed;
}
