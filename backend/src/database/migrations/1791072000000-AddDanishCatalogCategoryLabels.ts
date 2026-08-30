import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddDanishCatalogCategoryLabels1791072000000 implements MigrationInterface {
  readonly name = 'AddDanishCatalogCategoryLabels1791072000000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'da'); }
  down(): Promise<void> { return Promise.resolve(); }
}
