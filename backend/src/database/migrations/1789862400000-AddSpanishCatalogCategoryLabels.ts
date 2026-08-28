import type { MigrationInterface, QueryRunner } from 'typeorm';

const LABELS = [
  ['animals', 'Animales'],
  ['nature-flowers', 'Naturaleza y flores'],
  ['people', 'Personas'],
  ['places-architecture', 'Lugares y arquitectura'],
  ['food-drink', 'Comida y bebida'],
  ['holidays-seasons', 'Festividades y estaciones'],
  ['fantasy', 'Fantasía'],
  ['geometric-abstract', 'Geométrico y abstracto'],
  ['words-symbols', 'Palabras y símbolos'],
  ['other', 'Otros'],
] as const;

export class AddSpanishCatalogCategoryLabels1789862400000 implements MigrationInterface {
  readonly name = 'AddSpanishCatalogCategoryLabels1789862400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [categoryCode, label] of LABELS) {
      await queryRunner.query(
        `INSERT INTO "catalog"."category_labels" ("category_code", "locale", "label") VALUES ($1, 'es', $2)`,
        [categoryCode, label],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "catalog"."category_labels" WHERE "locale" = 'es' AND "category_code" IN (${LABELS.map((_, index) => `$${index + 1}`).join(', ')})`,
      LABELS.map(([categoryCode]) => categoryCode),
    );
  }
}
