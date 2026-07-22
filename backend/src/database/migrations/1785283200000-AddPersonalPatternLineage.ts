import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPersonalPatternLineage1785283200000 implements MigrationInterface {
  readonly name = 'AddPersonalPatternLineage1785283200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversion"."personal_patterns" ALTER COLUMN "processing_job_id" DROP NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "conversion"."personal_patterns" ADD COLUMN "derived_from_pattern_id" uuid NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "conversion"."personal_patterns"
         ADD CONSTRAINT "FK_personal_patterns_derived_from"
         FOREIGN KEY ("derived_from_pattern_id") REFERENCES "catalog"."patterns"("id")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversion"."personal_patterns" DROP CONSTRAINT "FK_personal_patterns_derived_from"`
    );
    await queryRunner.query(
      `ALTER TABLE "conversion"."personal_patterns" DROP COLUMN "derived_from_pattern_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "conversion"."personal_patterns" ALTER COLUMN "processing_job_id" SET NOT NULL`
    );
  }
}
