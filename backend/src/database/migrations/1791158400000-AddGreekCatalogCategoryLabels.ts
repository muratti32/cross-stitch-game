import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddGreekCatalogCategoryLabels1791158400000 implements MigrationInterface {
  readonly name = 'AddGreekCatalogCategoryLabels1791158400000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'el'); }
  down(): Promise<void> { return Promise.resolve(); }
}
