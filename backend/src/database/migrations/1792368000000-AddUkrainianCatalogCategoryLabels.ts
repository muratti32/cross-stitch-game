import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddUkrainianCatalogCategoryLabels1792368000000 implements MigrationInterface {
  readonly name = 'AddUkrainianCatalogCategoryLabels1792368000000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'uk'); }
  down(): Promise<void> { return Promise.resolve(); }
}
