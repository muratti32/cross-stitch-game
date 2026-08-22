import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Paid reserve is provider-minted value only. Negative balances are allowed for reversals. */
export class AddPaidBalanceProvenance1789257600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['coin_balances', 'ai_credit_balances']) {
      await queryRunner.query(`ALTER TABLE "economy"."${table}" ADD COLUMN "paid_balance" bigint NOT NULL DEFAULT 0`);
    }
    await queryRunner.query(`
      DO $$
      DECLARE r record; l record; b bigint; p bigint; free bigint;
      BEGIN
        FOR r IN SELECT DISTINCT principal_type, principal_id FROM economy.coin_ledger_entries LOOP
          b := 0; p := 0;
          FOR l IN SELECT amount, reason FROM economy.coin_ledger_entries WHERE principal_type=r.principal_type AND principal_id=r.principal_id ORDER BY created_at, id LOOP
            IF l.reason = 'coin_pack_purchase' AND l.amount > 0 THEN p := p + l.amount;
            ELSIF l.reason = 'commerce_reversal' AND l.amount < 0 THEN p := GREATEST(0, p - LEAST(p, -l.amount));
            ELSIF l.amount < 0 THEN free := GREATEST(0, b - p); p := GREATEST(0, p - GREATEST(0, -l.amount - free)); END IF;
            b := b + l.amount;
          END LOOP;
          UPDATE economy.coin_balances SET paid_balance=p WHERE principal_type=r.principal_type AND principal_id=r.principal_id;
        END LOOP;
        FOR r IN SELECT DISTINCT principal_type, principal_id FROM economy.ai_credit_ledger_entries LOOP
          b := 0; p := 0;
          FOR l IN SELECT amount, reason FROM economy.ai_credit_ledger_entries WHERE principal_type=r.principal_type AND principal_id=r.principal_id ORDER BY created_at, id LOOP
            IF l.reason = 'pack_purchase' AND l.amount > 0 THEN p := p + l.amount;
            ELSIF l.reason = 'commerce_reversal' AND l.amount < 0 THEN p := GREATEST(0, p - LEAST(p, -l.amount));
            ELSIF l.amount < 0 THEN free := GREATEST(0, b - p); p := GREATEST(0, p - GREATEST(0, -l.amount - free)); END IF;
            b := b + l.amount;
          END LOOP;
          UPDATE economy.ai_credit_balances SET paid_balance=p WHERE principal_type=r.principal_type AND principal_id=r.principal_id;
        END LOOP;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "economy"."ai_credit_balances" DROP COLUMN "paid_balance"');
    await queryRunner.query('ALTER TABLE "economy"."coin_balances" DROP COLUMN "paid_balance"');
  }
}
