import type { MigrationInterface, QueryRunner } from 'typeorm';

const LABELS = [
  ['animals', 'Animali'],
  ['nature-flowers', 'Natura e Fiori'],
  ['people', 'Persone'],
  ['places-architecture', 'Luoghi e Architettura'],
  ['food-drink', 'Cibo e Bevande'],
  ['holidays-seasons', 'Festività e Stagioni'],
  ['fantasy', 'Fantasy'],
  ['geometric-abstract', 'Geometrico e Astratto'],
  ['words-symbols', 'Scritte e Simboli'],
  ['other', 'Altro'],
] as const;

export class AddItalianCatalogCategoryLabels1790121600000 implements MigrationInterface {
  readonly name = 'AddItalianCatalogCategoryLabels1790121600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [categoryCode, label] of LABELS) {
      await queryRunner.query(
        `INSERT INTO "catalog"."category_labels" ("category_code", "locale", "label") VALUES ($1, 'it', $2)`,
        [categoryCode, label],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "catalog"."category_labels" WHERE "locale" = 'it' AND "category_code" IN (${LABELS.map((_, index) => `$${index + 1}`).join(', ')})`,
      LABELS.map(([categoryCode]) => categoryCode),
    );
  }
}
