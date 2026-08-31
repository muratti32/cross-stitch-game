import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddJapaneseCatalogCategoryLabels1790294400000 implements MigrationInterface {
  readonly name = 'AddJapaneseCatalogCategoryLabels1790294400000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'ja'); }
  down(): Promise<void> { return Promise.resolve(); }
}
