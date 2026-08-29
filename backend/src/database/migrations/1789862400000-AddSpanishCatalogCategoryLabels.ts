import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddSpanishCatalogCategoryLabels1789862400000 implements MigrationInterface {
  readonly name = 'AddSpanishCatalogCategoryLabels1789862400000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'es'); }
  down(): Promise<void> { return Promise.resolve(); }
}
