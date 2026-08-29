import type { QueryRunner } from 'typeorm';

import type { CandidateAppDisplayLocale } from '../../catalog/candidate-locales.constant';
import { CANDIDATE_CATEGORY_LABELS, CANDIDATE_TAG_LABELS } from '../../catalog/candidate-taxonomy-labels';

export async function upsertCandidateTaxonomyLabels(queryRunner: QueryRunner, locale: CandidateAppDisplayLocale): Promise<void> {
  for (const [categoryCode, labels] of Object.entries(CANDIDATE_CATEGORY_LABELS)) {
    await queryRunner.query(
      `INSERT INTO "catalog"."category_labels" ("category_code", "locale", "label")
       SELECT "code", $2, $3 FROM "catalog"."categories" WHERE "code" = $1
       ON CONFLICT ("category_code", "locale") DO UPDATE SET "label" = EXCLUDED."label"`,
      [categoryCode, locale, labels[locale]],
    );
  }
  for (const [tagCode, labels] of Object.entries(CANDIDATE_TAG_LABELS)) {
    await queryRunner.query(
      `INSERT INTO "catalog"."tag_labels" ("tag_code", "locale", "label")
       SELECT "code", $2, $3 FROM "catalog"."tags" WHERE "code" = $1
       ON CONFLICT ("tag_code", "locale") DO UPDATE SET "label" = EXCLUDED."label"`,
      [tagCode, locale, labels[locale]],
    );
  }
}
