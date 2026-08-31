import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddNorwegianBokmalCatalogCategoryLabels1791763200000 implements MigrationInterface {
  readonly name = 'AddNorwegianBokmalCatalogCategoryLabels1791763200000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'nb'); }
  down(): Promise<void> { return Promise.resolve(); }
}
