import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CurrentPrincipal, OptionalJwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('staff-picks')
  @UseGuards(OptionalJwtAuthGuard)
  async getStaffPicks(
    @Query('locale') locale?: string,
    @CurrentPrincipal() principal?: AuthPrincipal,
  ) {
    return this.catalogService.getStaffPicks(locale || 'en', principal);
  }

  @Get('new')
  @UseGuards(OptionalJwtAuthGuard)
  async getNewPatterns(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('locale') locale?: string,
    @CurrentPrincipal() principal?: AuthPrincipal,
  ) {
    const parsedLimit = parseInt(limit || '10', 10);
    return this.catalogService.getNewPatterns(parsedLimit, cursor, locale || 'en', principal);
  }

  @Get('categories')
  async getCategories() {
    return this.catalogService.getCategories();
  }

  @Get('tags')
  async getTags(@Query('locale') locale?: string) {
    return this.catalogService.getTags(locale || 'en');
  }

  @Get('patterns')
  @UseGuards(OptionalJwtAuthGuard)
  async getPatterns(
    @Query('category') category?: string,
    @Query('tag') tag?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('locale') locale?: string,
    @CurrentPrincipal() principal?: AuthPrincipal,
  ) {
    const parsedLimit = parseInt(limit || '10', 10);
    return this.catalogService.getPatterns({
      category,
      tag,
      cursor,
      limit: parsedLimit,
      locale: locale || 'en',
      principal,
    });
  }

  @Get('patterns/:id')
  @UseGuards(OptionalJwtAuthGuard)
  async getPatternById(
    @Param('id') id: string,
    @Query('locale') locale?: string,
    @CurrentPrincipal() principal?: AuthPrincipal,
  ) {
    return this.catalogService.getPatternById(id, locale || 'en', principal);
  }

  @Get('search')
  @UseGuards(OptionalJwtAuthGuard)
  async searchPatterns(
    @Query('q') q?: string,
    @Query('locale') locale?: string,
    @Query('limit') limit?: string,
    @CurrentPrincipal() principal?: AuthPrincipal,
  ) {
    const parsedLimit = parseInt(limit || '10', 10);
    return this.catalogService.searchPatterns(q || '', parsedLimit, locale || 'en', principal);
  }
}
