import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { AppConfigService } from '../config/app-config.service';
import { WebhookDeliveryArchiveService } from '../webhooks';
import { ApproveAiArtworkDto } from './dto/approve-ai-artwork.dto';
import { CreateAiArtworkDto } from './dto/create-ai-artwork.dto';
import { AiArtworkService } from './ai-artwork.service';

@Controller('ai-artworks')
export class AiArtworkController {
  constructor(
    private readonly ai: AiArtworkService,
    private readonly config: AppConfigService,
    private readonly archive: WebhookDeliveryArchiveService,
  ) {}
  @Post() @UseGuards(JwtAuthGuard) @HttpCode(HttpStatus.ACCEPTED) create(@CurrentPrincipal() p: AuthPrincipal, @Body() dto: CreateAiArtworkDto) { return this.ai.create(p, dto); }
  @Get() @UseGuards(JwtAuthGuard) list(@CurrentPrincipal() p: AuthPrincipal) { return this.ai.list(p); }
  @Get(':id') @UseGuards(JwtAuthGuard) job(@CurrentPrincipal() p: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) { return this.ai.getJob(p, id); }
  @Delete(':id') @UseGuards(JwtAuthGuard) @HttpCode(HttpStatus.NO_CONTENT) remove(@CurrentPrincipal() p: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) { return this.ai.delete(p, id); }
  @Post(':id/approve') @UseGuards(JwtAuthGuard) @HttpCode(HttpStatus.ACCEPTED) approve(@CurrentPrincipal() p: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveAiArtworkDto) { return this.ai.approve(p, id, dto); }
  @Post('fal/webhook') @HttpCode(HttpStatus.NO_CONTENT) async webhook(@Query('jobId') jobId: string, @Query('key') key: string, @Query('token') token: string, @Body() body: { request_id?: unknown }, @Res() res: Response) {
    const requestId = typeof body.request_id === 'string' ? body.request_id : null;
    if (!isUuid(jobId) || !isUuid(key) || token !== this.config.falWebhookSecret || requestId === null) {
      await this.archive.archive({ failureReason: 'Invalid fal.ai webhook authentication or body', payload: requestId === null ? {} : { body: { request_id: requestId }, jobId }, processingOutcome: 'verification_failed', provider: 'fal', providerDeliveryId: requestId, verificationResult: 'failed' });
      if (!isUuid(jobId) || !isUuid(key)) throw new BadRequestException('Validation failed (uuid is expected)');
      res.status(HttpStatus.UNAUTHORIZED).send(); return;
    }
    try {
      await this.ai.verifyWebhookKey(jobId, key);
      const duplicate = await this.ai.handleVerifiedWebhook(jobId, requestId);
      await this.archive.archive({ payload: { body: { request_id: requestId }, jobId }, processingOutcome: duplicate ? 'duplicate_ignored' : 'processed', provider: 'fal', providerDeliveryId: requestId, verificationResult: 'verified' });
      res.status(HttpStatus.NO_CONTENT).send();
    } catch (error: unknown) {
      await this.archive.archive({ failureReason: error instanceof Error ? error.message : 'fal.ai webhook handling failed', payload: { body: { request_id: requestId }, jobId }, processingOutcome: 'failed', provider: 'fal', providerDeliveryId: requestId, verificationResult: 'verified' });
      throw error;
    }
  }
  @Get('images/:id') async image(@Param('id', ParseUUIDPipe) id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) { const image = await this.ai.image(id, Number(exp), sig); res.setHeader('Content-Type', image.contentType); res.setHeader('Cache-Control', 'private, max-age=300'); res.send(image.bytes); }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
