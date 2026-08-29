import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddTurkishCatalogTaxonomyLabels1789689600001 implements MigrationInterface {
  readonly name = 'AddTurkishCatalogTaxonomyLabels1789689600001';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'tr'); }
  down(): Promise<void> { return Promise.resolve(); }
}
