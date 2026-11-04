import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPromotionModeToTransferPackages1793145600000 implements MigrationInterface {
  readonly name = 'AddPromotionModeToTransferPackages1793145600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "promotion"."transfer_packages"
      ADD COLUMN "promotion_mode" varchar(16) NULL,
      ADD CONSTRAINT "CHK_promotion_transfer_packages_promotion_mode"
        CHECK ("promotion_mode" IN ('economy', 'data-only'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "promotion"."transfer_packages"
      DROP CONSTRAINT "CHK_promotion_transfer_packages_promotion_mode",
      DROP COLUMN "promotion_mode"
    `);
  }
}
