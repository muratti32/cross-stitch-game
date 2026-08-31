import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddCzechCatalogCategoryLabels1790985600000 implements MigrationInterface {
  readonly name = 'AddCzechCatalogCategoryLabels1790985600000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'cs'); }
  down(): Promise<void> { return Promise.resolve(); }
}
