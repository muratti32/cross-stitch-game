import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddBrazilianPortugueseCatalogCategoryLabels1789948800000 implements MigrationInterface {
  readonly name = 'AddBrazilianPortugueseCatalogCategoryLabels1789948800000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'pt-BR'); }
  down(): Promise<void> { return Promise.resolve(); }
}
