import {
  BadRequestException,
  Body,
  Controller,
  Get,
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

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { ConversionService, UploadedArtwork } from './conversion.service';
import { CreatePhotoConversionDto } from './dto/create-photo-conversion.dto';
import { CreateDerivedPatternDto } from './dto/create-derived-pattern.dto';
import { DMC_COLORS } from './dmc-colors.data';

@Controller('conversions')
@UseGuards(JwtAuthGuard)
export class ConversionController {
  constructor(private readonly conversions: ConversionService) {}

  @Post('photo')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('artwork', {
      fileFilter: (_request, file, callback) => {
        if (file.mimetype !== 'image/jpeg' && file.mimetype !== 'image/png') {
          callback(new BadRequestException('Artwork must be JPEG or PNG'), false);
          return;
        }
        callback(null, true);
      },
      limits: { fieldSize: 1024, fields: 4, fileSize: 20 * 1024 * 1024, files: 1 },
    }),
  )
  createPhotoConversion(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreatePhotoConversionDto,
    @UploadedFile() artwork: UploadedArtwork | undefined,
  ) {
    return this.conversions.createPhotoConversion(principal, body, artwork);
  }

  @Get('jobs/:id')
  getJob(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.conversions.getConversionJob(principal, id);
  }

  @Get('patterns')
  listPatterns(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.conversions.listPersonalPatterns(principal);
  }

  @Post('personal-patterns/derived')
  @HttpCode(HttpStatus.CREATED)
  createDerivedPattern(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreateDerivedPatternDto,
  ) {
    return this.conversions.createDerivedPattern(principal, body);
  }

  @Get('dmc-colors')
  listDmcColors() {
    return DMC_COLORS;
  }

  @Get('personal-patterns/:id/artifact-grant')
  getPersonalPatternArtifactGrant(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.conversions.getPersonalPatternArtifactGrant(principal, id);
  }
}

@Controller('personal-pattern-previews')
export class PersonalPatternPreviewsController {
  constructor(private readonly conversions: ConversionService) {}

  @Get(':id')
  async getPreview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('exp') exp: string,
    @Query('sig') signature: string,
    @Res() response: Response,
  ): Promise<void> {
    const bytes = await this.conversions.getSignedPreview(
      id,
      Number(exp),
      signature,
    );
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('Content-Type', 'image/png');
    response.send(bytes);
  }
}

@Controller('personal-pattern-thumbnails')
export class PersonalPatternThumbnailsController {
  constructor(private readonly conversions: ConversionService) {}

  @Get(':id/:variant')
  async getThumbnail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('variant') variant: string,
    @Query('exp') exp: string,
    @Query('sig') signature: string,
    @Res() response: Response,
  ): Promise<void> {
    if (variant !== 'browsing' && variant !== 'detail') {
      throw new BadRequestException('Thumbnail variant must be browsing or detail');
    }
    const bytes = await this.conversions.getSignedThumbnail(
      id,
      variant,
      Number(exp),
      signature,
    );
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('Content-Type', 'image/png');
    response.send(bytes);
  }
}

@Controller('personal-pattern-artifacts')
export class PersonalPatternArtifactsController {
  constructor(private readonly conversions: ConversionService) {}

  @Get(':id')
  async getArtifact(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('exp') exp: string,
    @Query('sig') signature: string,
    @Res() response: Response,
  ): Promise<void> {
    const bytes = await this.conversions.getSignedArtifact(
      id,
      Number(exp),
      signature,
    );
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('Content-Type', 'application/octet-stream');
    response.send(bytes);
  }
}
