import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddSwedishCatalogCategoryLabels1792195200000 implements MigrationInterface {
  readonly name = 'AddSwedishCatalogCategoryLabels1792195200000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'sv'); }
  down(): Promise<void> { return Promise.resolve(); }
}
