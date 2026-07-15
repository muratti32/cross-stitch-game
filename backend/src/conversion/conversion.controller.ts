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
