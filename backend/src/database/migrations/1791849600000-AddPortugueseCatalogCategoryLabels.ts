import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddPortugueseCatalogCategoryLabels1791849600000 implements MigrationInterface {
  readonly name = 'AddPortugueseCatalogCategoryLabels1791849600000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'pt'); }
  down(): Promise<void> { return Promise.resolve(); }
}
