import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddFinnishCatalogCategoryLabels1791244800000 implements MigrationInterface {
  readonly name = 'AddFinnishCatalogCategoryLabels1791244800000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'fi'); }
  down(): Promise<void> { return Promise.resolve(); }
}
