import type { MigrationInterface, QueryRunner } from 'typeorm';

const LABELS = [
  ['animals', 'Animais'],
  ['nature-flowers', 'Natureza e Flores'],
  ['people', 'Pessoas'],
  ['places-architecture', 'Lugares e Arquitetura'],
  ['food-drink', 'Comidas e Bebidas'],
  ['holidays-seasons', 'Datas Comemorativas e Estações'],
  ['fantasy', 'Fantasia'],
  ['geometric-abstract', 'Geométrico e Abstrato'],
  ['words-symbols', 'Palavras e Símbolos'],
  ['other', 'Outros'],
] as const;

export class AddBrazilianPortugueseCatalogCategoryLabels1789948800000 implements MigrationInterface {
  readonly name = 'AddBrazilianPortugueseCatalogCategoryLabels1789948800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [categoryCode, label] of LABELS) {
      await queryRunner.query(
        `INSERT INTO "catalog"."category_labels" ("category_code", "locale", "label") VALUES ($1, 'pt-BR', $2)`,
        [categoryCode, label],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "catalog"."category_labels" WHERE "locale" = 'pt-BR' AND "category_code" IN (${LABELS.map((_, index) => `$${index + 1}`).join(', ')})`,
      LABELS.map(([categoryCode]) => categoryCode),
    );
  }
}
