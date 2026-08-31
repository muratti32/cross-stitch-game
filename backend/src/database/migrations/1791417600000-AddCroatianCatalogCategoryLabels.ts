import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddCroatianCatalogCategoryLabels1791417600000 implements MigrationInterface {
  readonly name = 'AddCroatianCatalogCategoryLabels1791417600000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'hr'); }
  down(): Promise<void> { return Promise.resolve(); }
}
