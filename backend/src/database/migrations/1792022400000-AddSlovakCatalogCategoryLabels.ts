import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddSlovakCatalogCategoryLabels1792022400000 implements MigrationInterface {
  readonly name = 'AddSlovakCatalogCategoryLabels1792022400000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'sk'); }
  down(): Promise<void> { return Promise.resolve(); }
}
