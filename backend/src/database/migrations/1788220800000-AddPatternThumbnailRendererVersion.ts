import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPatternThumbnailRendererVersion1788220800000 implements MigrationInterface {
  readonly name = 'AddPatternThumbnailRendererVersion1788220800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."patterns" ADD COLUMN IF NOT EXISTS "thumbnail_renderer_version" integer`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."patterns" DROP COLUMN IF EXISTS "thumbnail_renderer_version"`,
    );
  }
}
