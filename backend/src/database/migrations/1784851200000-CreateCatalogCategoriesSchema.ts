import type { MigrationInterface, QueryRunner } from 'typeorm';

// Categories were a hardcoded enum (FIXED_CATEGORIES in catalog.constants.ts)
// until this migration. The ten first-release codes/labels below are that
// same fixed set, now seeded as mutable rows so the Operator Console can
// manage them the same way it manages Catalog Tags (create, relabel,
// deactivate — never hard-deleted once a Pattern can reference them).
const SEED_CATEGORIES: { code: string; label: string }[] = [
  { code: 'animals', label: 'Animals' },
  { code: 'nature-flowers', label: 'Nature & Flowers' },
  { code: 'people', label: 'People' },
  { code: 'places-architecture', label: 'Places & Architecture' },
  { code: 'food-drink', label: 'Food & Drink' },
  { code: 'holidays-seasons', label: 'Holidays & Seasons' },
  { code: 'fantasy', label: 'Fantasy' },
  { code: 'geometric-abstract', label: 'Geometric & Abstract' },
  { code: 'words-symbols', label: 'Words & Symbols' },
  { code: 'other', label: 'Other' },
];

export class CreateCatalogCategoriesSchema1784851200000
  implements MigrationInterface
{
  readonly name = 'CreateCatalogCategoriesSchema1784851200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "catalog"."categories" (
        "code" varchar(64) NOT NULL,
        "label" varchar(255) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_categories" PRIMARY KEY ("code")
      )
    `);

    for (const category of SEED_CATEGORIES) {
      await queryRunner.query(
        `INSERT INTO "catalog"."categories" ("code", "label") VALUES ($1, $2)`,
        [category.code, category.label],
      );
    }

    await queryRunner.query(`
      ALTER TABLE "catalog"."patterns"
      ADD CONSTRAINT "FK_patterns_category_code"
      FOREIGN KEY ("category_code") REFERENCES "catalog"."categories"("code")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."patterns" DROP CONSTRAINT IF EXISTS "FK_patterns_category_code"`,
    );
    await queryRunner.query('DROP TABLE IF EXISTS "catalog"."categories"');
  }
}
