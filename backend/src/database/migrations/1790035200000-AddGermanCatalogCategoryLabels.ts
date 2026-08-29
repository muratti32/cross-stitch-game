import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddGermanCatalogCategoryLabels1790035200000 implements MigrationInterface {
  readonly name = 'AddGermanCatalogCategoryLabels1790035200000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'de'); }
  down(): Promise<void> { return Promise.resolve(); }
}
