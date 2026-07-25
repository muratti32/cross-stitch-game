import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiArtworkCancelledStatus1787097600000 implements MigrationInterface {
  readonly name = 'AddAiArtworkCancelledStatus1787097600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai"."ai_artworks"
      DROP CONSTRAINT "CHK_ai_artworks_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "ai"."ai_artworks"
      ADD CONSTRAINT "CHK_ai_artworks_status"
      CHECK ("status" IN ('pending', 'submitting', 'submitted', 'delivered', 'safety_rejected', 'failed', 'deleted', 'cancelled'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai"."ai_artworks"
      DROP CONSTRAINT "CHK_ai_artworks_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "ai"."ai_artworks"
      ADD CONSTRAINT "CHK_ai_artworks_status"
      CHECK ("status" IN ('pending', 'submitting', 'submitted', 'delivered', 'safety_rejected', 'failed', 'deleted'))
    `);
  }
}
