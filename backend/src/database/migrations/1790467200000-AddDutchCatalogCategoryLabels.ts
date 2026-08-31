import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddDutchCatalogCategoryLabels1790467200000 implements MigrationInterface {
  readonly name = 'AddDutchCatalogCategoryLabels1790467200000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'nl'); }
  down(): Promise<void> { return Promise.resolve(); }
}
