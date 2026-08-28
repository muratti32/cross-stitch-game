import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalizeCatalogCategoryLabels1789689600000 implements MigrationInterface {
  readonly name = 'LocalizeCatalogCategoryLabels1789689600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "catalog"."category_labels" (
        "category_code" varchar(64) NOT NULL,
        "locale" varchar(8) NOT NULL,
        "label" varchar(255) NOT NULL,
        CONSTRAINT "PK_category_labels" PRIMARY KEY ("category_code", "locale"),
        CONSTRAINT "FK_category_labels_categories" FOREIGN KEY ("category_code") REFERENCES "catalog"."categories"("code") ON DELETE CASCADE
      )
    `);
    await queryRunner.query('CREATE INDEX "IDX_category_labels_label" ON "catalog"."category_labels" ("label")');
    await queryRunner.query(`
      INSERT INTO "catalog"."category_labels" ("category_code", "locale", "label")
      SELECT "code", 'en', "label" FROM "catalog"."categories"
    `);
    await queryRunner.query('ALTER TABLE "catalog"."categories" DROP COLUMN "label"');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "catalog"."categories" ADD COLUMN "label" varchar(255)');
    await queryRunner.query(`
      UPDATE "catalog"."categories" category
      SET "label" = labels."label"
      FROM "catalog"."category_labels" labels
      WHERE labels."category_code" = category."code" AND labels."locale" = 'en'
    `);
    await queryRunner.query('ALTER TABLE "catalog"."categories" ALTER COLUMN "label" SET NOT NULL');
    await queryRunner.query('DROP TABLE "catalog"."category_labels"');
  }
}
