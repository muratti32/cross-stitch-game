import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddKoreanCatalogCategoryLabels1790380800000 implements MigrationInterface {
  readonly name = 'AddKoreanCatalogCategoryLabels1790380800000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'ko'); }
  down(): Promise<void> { return Promise.resolve(); }
}
