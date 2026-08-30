import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddRomanianCatalogCategoryLabels1791936000000 implements MigrationInterface {
  readonly name = 'AddRomanianCatalogCategoryLabels1791936000000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'ro'); }
  down(): Promise<void> { return Promise.resolve(); }
}
