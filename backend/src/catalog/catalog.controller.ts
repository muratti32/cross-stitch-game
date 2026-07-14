import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('staff-picks')
  async getStaffPicks(@Query('locale') locale?: string) {
    return this.catalogService.getStaffPicks(locale || 'en');
  }

  @Get('new')
  async getNewPatterns(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('locale') locale?: string,
  ) {
    const parsedLimit = parseInt(limit || '10', 10);
    return this.catalogService.getNewPatterns(parsedLimit, cursor, locale || 'en');
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
  async getPatterns(
    @Query('category') category?: string,
    @Query('tag') tag?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('locale') locale?: string,
  ) {
    const parsedLimit = parseInt(limit || '10', 10);
    return this.catalogService.getPatterns({
      category,
      tag,
      cursor,
      limit: parsedLimit,
      locale: locale || 'en',
    });
  }

  @Get('patterns/:id')
  async getPatternById(
    @Param('id') id: string,
    @Query('locale') locale?: string,
  ) {
    return this.catalogService.getPatternById(id, locale || 'en');
  }

  @Get('search')
  async searchPatterns(
    @Query('q') q?: string,
    @Query('locale') locale?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = parseInt(limit || '10', 10);
    return this.catalogService.searchPatterns(q || '', parsedLimit, locale || 'en');
  }
}
