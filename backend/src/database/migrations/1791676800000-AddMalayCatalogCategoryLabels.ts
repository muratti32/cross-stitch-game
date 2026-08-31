import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddMalayCatalogCategoryLabels1791676800000 implements MigrationInterface {
  readonly name = 'AddMalayCatalogCategoryLabels1791676800000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'ms'); }
  down(): Promise<void> { return Promise.resolve(); }
}
