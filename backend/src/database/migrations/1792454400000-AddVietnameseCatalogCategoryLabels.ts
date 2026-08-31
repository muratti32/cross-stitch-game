import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddVietnameseCatalogCategoryLabels1792454400000 implements MigrationInterface {
  readonly name = 'AddVietnameseCatalogCategoryLabels1792454400000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'vi'); }
  down(): Promise<void> { return Promise.resolve(); }
}
