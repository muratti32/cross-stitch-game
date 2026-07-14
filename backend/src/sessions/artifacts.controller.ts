import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SessionsService } from './sessions.service';
import { LocalObjectStorage } from '../catalog/storage/local-object-storage';
import { PatternEntity } from '../catalog/entities';

@Controller('artifacts')
export class ArtifactsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly storage: LocalObjectStorage,
    @InjectRepository(PatternEntity)
    private readonly patternRepo: Repository<PatternEntity>,
  ) {}

  @Get(':patternId')
  async getArtifact(
    @Param('patternId') patternId: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const expires = parseInt(exp, 10);
    if (isNaN(expires)) {
      throw new ForbiddenException('Invalid expiration');
    }

    const isValid = this.sessionsService.verifyGrant(patternId, expires, sig);
    if (!isValid) {
      throw new ForbiddenException('Invalid or expired grant');
    }

    const pattern = await this.patternRepo.findOne({ where: { id: patternId } });
    if (!pattern) {
      throw new NotFoundException('Pattern not found');
    }

    const buffer = await this.storage.get(pattern.artifactObjectKey);
    if (!buffer) {
      throw new NotFoundException('Artifact file not found');
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }
}
