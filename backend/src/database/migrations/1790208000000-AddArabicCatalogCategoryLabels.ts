import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddArabicCatalogCategoryLabels1790208000000 implements MigrationInterface {
  readonly name = 'AddArabicCatalogCategoryLabels1790208000000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'ar'); }
  down(): Promise<void> { return Promise.resolve(); }
}
