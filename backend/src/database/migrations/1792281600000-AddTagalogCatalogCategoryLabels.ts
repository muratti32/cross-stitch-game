import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddTagalogCatalogCategoryLabels1792281600000 implements MigrationInterface {
  readonly name = 'AddTagalogCatalogCategoryLabels1792281600000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'tl'); }
  down(): Promise<void> { return Promise.resolve(); }
}
