import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { ApproveAiArtworkDto } from './dto/approve-ai-artwork.dto';
import { CreateAiArtworkDto } from './dto/create-ai-artwork.dto';
import { AiArtworkService } from './ai-artwork.service';

@Controller('ai-artworks')
export class AiArtworkController {
  constructor(private readonly ai: AiArtworkService) {}
  @Post() @UseGuards(JwtAuthGuard) @HttpCode(HttpStatus.ACCEPTED) create(@CurrentPrincipal() p: AuthPrincipal, @Body() dto: CreateAiArtworkDto) { return this.ai.create(p, dto); }
  @Get() @UseGuards(JwtAuthGuard) list(@CurrentPrincipal() p: AuthPrincipal) { return this.ai.list(p); }
  @Get(':id') @UseGuards(JwtAuthGuard) job(@CurrentPrincipal() p: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) { return this.ai.getJob(p, id); }
  @Delete(':id') @UseGuards(JwtAuthGuard) @HttpCode(HttpStatus.NO_CONTENT) remove(@CurrentPrincipal() p: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) { return this.ai.delete(p, id); }
  @Post(':id/approve') @UseGuards(JwtAuthGuard) @HttpCode(HttpStatus.ACCEPTED) approve(@CurrentPrincipal() p: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveAiArtworkDto) { return this.ai.approve(p, id, dto); }
  @Post('fal/webhook') @HttpCode(HttpStatus.NO_CONTENT) async webhook(@Query('jobId', ParseUUIDPipe) jobId: string, @Query('key', ParseUUIDPipe) key: string, @Query('token') token: string, @Body() body: { request_id?: unknown }, @Res() res: Response) { if (token !== process.env.FAL_WEBHOOK_SECRET || typeof body.request_id !== 'string') { res.status(HttpStatus.UNAUTHORIZED).send(); return; } await this.ai.webhook(jobId, key, body.request_id); res.status(HttpStatus.NO_CONTENT).send(); }
  @Get('images/:id') async image(@Param('id', ParseUUIDPipe) id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) { const image = await this.ai.image(id, Number(exp), sig); res.setHeader('Content-Type', image.contentType); res.setHeader('Cache-Control', 'private, max-age=300'); res.send(image.bytes); }
}
