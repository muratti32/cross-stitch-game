import type { MigrationInterface, QueryRunner } from 'typeorm';

const LABELS = [
  ['animals', 'Animaux'],
  ['nature-flowers', 'Nature et fleurs'],
  ['people', 'Personnes'],
  ['places-architecture', 'Lieux et architecture'],
  ['food-drink', 'Cuisine et boissons'],
  ['holidays-seasons', 'Fêtes et saisons'],
  ['fantasy', 'Fantaisie'],
  ['geometric-abstract', 'Géométrique et abstrait'],
  ['words-symbols', 'Mots et symboles'],
  ['other', 'Autres'],
] as const;

export class AddFrenchCatalogCategoryLabels1789776000000 implements MigrationInterface {
  readonly name = 'AddFrenchCatalogCategoryLabels1789776000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [categoryCode, label] of LABELS) {
      await queryRunner.query(
        `INSERT INTO "catalog"."category_labels" ("category_code", "locale", "label") VALUES ($1, 'fr', $2)`,
        [categoryCode, label],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "catalog"."category_labels" WHERE "locale" = 'fr' AND "category_code" IN (${LABELS.map((_, index) => `$${index + 1}`).join(', ')})`,
      LABELS.map(([categoryCode]) => categoryCode),
    );
  }
}
