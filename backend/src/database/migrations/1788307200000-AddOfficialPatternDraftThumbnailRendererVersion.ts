import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfficialPatternDraftThumbnailRendererVersion1788307200000
  implements MigrationInterface
{
  readonly name = 'AddOfficialPatternDraftThumbnailRendererVersion1788307200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admin"."official_pattern_drafts" ADD COLUMN IF NOT EXISTS "thumbnail_renderer_version" integer`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admin"."official_pattern_drafts" DROP COLUMN IF EXISTS "thumbnail_renderer_version"`,
    );
  }
}
