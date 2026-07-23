import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenPackageStatusForNeedsAttention1785542400000 implements MigrationInterface {
  readonly name = 'WidenPackageStatusForNeedsAttention1785542400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "promotion"."transfer_packages"
      DROP CONSTRAINT "CHK_promotion_transfer_packages_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "promotion"."transfer_packages"
      ADD CONSTRAINT "CHK_promotion_transfer_packages_status"
      CHECK ("status" IN ('staged', 'committed', 'cancelled', 'needs_attention'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "promotion"."transfer_packages"
      DROP CONSTRAINT "CHK_promotion_transfer_packages_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "promotion"."transfer_packages"
      ADD CONSTRAINT "CHK_promotion_transfer_packages_status"
      CHECK ("status" IN ('staged', 'committed', 'cancelled'))
    `);
  }
}
