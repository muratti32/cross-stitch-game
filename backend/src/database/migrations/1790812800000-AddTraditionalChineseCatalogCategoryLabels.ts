import type { MigrationInterface, QueryRunner } from 'typeorm';

import { upsertCandidateTaxonomyLabels } from '../migration-helpers/candidate-taxonomy-labels';

export class AddTraditionalChineseCatalogCategoryLabels1790812800000 implements MigrationInterface {
  readonly name = 'AddTraditionalChineseCatalogCategoryLabels1790812800000';
  up(queryRunner: QueryRunner): Promise<void> { return upsertCandidateTaxonomyLabels(queryRunner, 'zh-Hant'); }
  down(): Promise<void> { return Promise.resolve(); }
}
