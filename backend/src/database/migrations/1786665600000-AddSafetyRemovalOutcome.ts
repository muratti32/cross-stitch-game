import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSafetyRemovalOutcome1786665600000 implements MigrationInterface {
  readonly name = 'AddSafetyRemovalOutcome1786665600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "moderation"."post_publication_reviews"
      DROP CONSTRAINT "CHK_post_publication_reviews_close_outcome"
    `);
    await queryRunner.query(`
      ALTER TABLE "moderation"."post_publication_reviews"
      ADD CONSTRAINT "CHK_post_publication_reviews_close_outcome"
      CHECK ("close_outcome" IN ('no_violation', 'metadata_remediation', 'safety_removal'))
    `);

    await queryRunner.query(`
      ALTER TABLE "moderation"."moderation_notices"
      DROP CONSTRAINT "CHK_moderation_notices_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "moderation"."moderation_notices"
      ADD CONSTRAINT "CHK_moderation_notices_type"
      CHECK ("notice_type" IN ('review_hold', 'no_violation', 'metadata_remediation', 'safety_removal'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "moderation"."moderation_notices"
      DROP CONSTRAINT "CHK_moderation_notices_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "moderation"."moderation_notices"
      ADD CONSTRAINT "CHK_moderation_notices_type"
      CHECK ("notice_type" IN ('review_hold', 'no_violation', 'metadata_remediation'))
    `);

    await queryRunner.query(`
      ALTER TABLE "moderation"."post_publication_reviews"
      DROP CONSTRAINT "CHK_post_publication_reviews_close_outcome"
    `);
    await queryRunner.query(`
      ALTER TABLE "moderation"."post_publication_reviews"
      ADD CONSTRAINT "CHK_post_publication_reviews_close_outcome"
      CHECK ("close_outcome" IN ('no_violation', 'metadata_remediation'))
    `);
  }
}
