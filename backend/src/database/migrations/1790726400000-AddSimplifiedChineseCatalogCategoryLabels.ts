import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddSimplifiedChineseCatalogCategoryLabels1790726400000 implements MigrationInterface {
  readonly name = 'AddSimplifiedChineseCatalogCategoryLabels1790726400000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'zh-Hans'); }
  down(): Promise<void> { return Promise.resolve(); }
}
