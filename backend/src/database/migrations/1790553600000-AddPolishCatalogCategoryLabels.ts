import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddPolishCatalogCategoryLabels1790553600000 implements MigrationInterface {
  readonly name = 'AddPolishCatalogCategoryLabels1790553600000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'pl'); }
  down(): Promise<void> { return Promise.resolve(); }
}
