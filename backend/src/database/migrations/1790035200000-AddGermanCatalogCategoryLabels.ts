import type { MigrationInterface, QueryRunner } from 'typeorm';

const LABELS = [
  ['animals', 'Tiere'],
  ['nature-flowers', 'Natur & Blumen'],
  ['people', 'Menschen'],
  ['places-architecture', 'Orte & Architektur'],
  ['food-drink', 'Essen & Trinken'],
  ['holidays-seasons', 'Feiertage & Jahreszeiten'],
  ['fantasy', 'Fantasy'],
  ['geometric-abstract', 'Geometrisch & Abstrakt'],
  ['words-symbols', 'Worte & Symbole'],
  ['other', 'Sonstiges'],
] as const;

export class AddGermanCatalogCategoryLabels1790035200000 implements MigrationInterface {
  readonly name = 'AddGermanCatalogCategoryLabels1790035200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [categoryCode, label] of LABELS) {
      await queryRunner.query(
        `INSERT INTO "catalog"."category_labels" ("category_code", "locale", "label") VALUES ($1, 'de', $2)`,
        [categoryCode, label],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "catalog"."category_labels" WHERE "locale" = 'de' AND "category_code" IN (${LABELS.map((_, index) => `$${index + 1}`).join(', ')})`,
      LABELS.map(([categoryCode]) => categoryCode),
    );
  }
}
