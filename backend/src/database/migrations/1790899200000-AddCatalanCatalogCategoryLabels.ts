import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddCatalanCatalogCategoryLabels1790899200000 implements MigrationInterface {
  readonly name = 'AddCatalanCatalogCategoryLabels1790899200000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'ca'); }
  down(): Promise<void> { return Promise.resolve(); }
}
