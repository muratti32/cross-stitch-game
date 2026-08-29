import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddFrenchCatalogCategoryLabels1789776000000 implements MigrationInterface {
  readonly name = 'AddFrenchCatalogCategoryLabels1789776000000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'fr'); }
  down(): Promise<void> { return Promise.resolve(); }
}
