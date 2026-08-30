import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddHungarianCatalogCategoryLabels1791504000000 implements MigrationInterface {
  readonly name = 'AddHungarianCatalogCategoryLabels1791504000000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'hu'); }
  down(): Promise<void> { return Promise.resolve(); }
}
