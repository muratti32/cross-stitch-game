import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { CreatorProfileService } from './creator-profile.service';
import { CreateCreatorProfileDto } from './dto/create-creator-profile.dto';
import { UpdateCreatorProfileDto } from './dto/update-creator-profile.dto';
import type { UploadedAvatar } from './profile-safety.service';

const avatarInterceptor = FileInterceptor('avatar', {
  fileFilter: (_request, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(new BadRequestException('Avatar must be JPEG, PNG, or WebP'), false);
      return;
    }
    callback(null, true);
  },
  limits: { fieldSize: 1024, fields: 3, fileSize: 5 * 1024 * 1024, files: 1 },
});

@Controller('creator-profiles')
export class CreatorProfileController {
  constructor(private readonly creatorProfiles: CreatorProfileService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(avatarInterceptor)
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: CreateCreatorProfileDto,
    @UploadedFile() avatar: UploadedAvatar | undefined,
  ) {
    return this.creatorProfiles.create(principal, dto, avatar);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.creatorProfiles.getMine(principal);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(avatarInterceptor)
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: UpdateCreatorProfileDto,
    @UploadedFile() avatar: UploadedAvatar | undefined,
  ) {
    return this.creatorProfiles.update(principal, dto, avatar);
  }

  @Get(':id/avatar')
  @HttpCode(HttpStatus.OK)
  async getAvatar(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const avatar = await this.creatorProfiles.getAvatar(id);
    response.setHeader('Cache-Control', 'public, no-cache');
    response.setHeader('Content-Type', avatar.contentType);
    response.send(avatar.bytes);
  }

  @Get(':id')
  getPublic(@Param('id', ParseUUIDPipe) id: string) {
    return this.creatorProfiles.getPublic(id);
  }
}
