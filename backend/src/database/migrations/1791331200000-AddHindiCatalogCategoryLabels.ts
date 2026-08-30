import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddHindiCatalogCategoryLabels1791331200000 implements MigrationInterface {
  readonly name = 'AddHindiCatalogCategoryLabels1791331200000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'hi'); }
  down(): Promise<void> { return Promise.resolve(); }
}
