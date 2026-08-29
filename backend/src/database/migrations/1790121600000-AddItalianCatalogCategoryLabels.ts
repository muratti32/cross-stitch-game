import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddItalianCatalogCategoryLabels1790121600000 implements MigrationInterface {
  readonly name = 'AddItalianCatalogCategoryLabels1790121600000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'it'); }
  down(): Promise<void> { return Promise.resolve(); }
}
