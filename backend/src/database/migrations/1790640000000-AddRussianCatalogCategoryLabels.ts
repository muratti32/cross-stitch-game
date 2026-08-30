import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddRussianCatalogCategoryLabels1790640000000 implements MigrationInterface {
  readonly name = 'AddRussianCatalogCategoryLabels1790640000000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'ru'); }
  down(): Promise<void> { return Promise.resolve(); }
}
