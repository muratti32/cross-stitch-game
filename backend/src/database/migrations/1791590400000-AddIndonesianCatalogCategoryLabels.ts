import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddIndonesianCatalogCategoryLabels1791590400000 implements MigrationInterface {
  readonly name = 'AddIndonesianCatalogCategoryLabels1791590400000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'id'); }
  down(): Promise<void> { return Promise.resolve(); }
}
