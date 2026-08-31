import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddSlovenianCatalogCategoryLabels1792108800000 implements MigrationInterface {
  readonly name = 'AddSlovenianCatalogCategoryLabels1792108800000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'sl'); }
  down(): Promise<void> { return Promise.resolve(); }
}
