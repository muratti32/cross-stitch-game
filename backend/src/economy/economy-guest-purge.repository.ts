import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { CoinLedgerReason } from './entities';

/**
 * Owns everything the `economy` schema holds for one Guest Installation, so a
 * Guest Data Reset run by the auth module never reaches across the schema
 * boundary itself. The caller supplies the transaction: the purge, the
 * tombstones it leaves behind, and the auth-side revocation must commit or
 * roll back together.
 */
@Injectable()
export class EconomyGuestPurgeRepository {
  /**
   * Guest Data Reset must not race a Purchase Attempt whose outcome the store
   * has not delivered yet, or the grant would land on an erased identity.
   */
  async assertNoUnresolvedPurchaseAttempt(
    manager: EntityManager,
    guestInstallationId: string,
  ): Promise<void> {
    const pendingRows = await manager.query<readonly { id: string }[]>(
      `SELECT id
       FROM economy.purchase_attempts
       WHERE principal_type = 'guest' AND principal_id = $1
         AND status IN ('created', 'verifying')
       LIMIT 1
       FOR UPDATE`,
      [guestInstallationId],
    );
    if (pendingRows.length > 0) {
      throw new ConflictException(
        'Guest Data Reset is unavailable while a Purchase Attempt is unresolved',
      );
    }
  }

  async purgeGuest(manager: EntityManager, guestInstallationId: string): Promise<void> {
    await this.tombstoneProviderGrants(manager, guestInstallationId);
    await this.tombstonePremiumDailyClaims(manager, guestInstallationId);

    await manager.query(
      `DELETE FROM economy.membership_events WHERE guest_installation_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.membership_periods WHERE guest_installation_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.premium_purchase_reconciliations WHERE guest_installation_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.purchase_attempts
       WHERE principal_type = 'guest' AND principal_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.revenuecat_subscriber_mappings WHERE guest_installation_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.coin_ledger_entries
       WHERE principal_type = 'guest' AND principal_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.ai_credit_ledger_entries
       WHERE principal_type = 'guest' AND principal_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.coin_balances
       WHERE principal_type = 'guest' AND principal_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.ai_credit_balances
       WHERE principal_type = 'guest' AND principal_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.reward_day_pools
       WHERE principal_type = 'guest' AND principal_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.gameplay_events
       WHERE principal_type = 'guest' AND principal_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.daily_color_action_counts
       WHERE principal_type = 'guest' AND principal_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.ad_attempts
       WHERE principal_type = 'guest' AND principal_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM economy.pattern_unlocks
       WHERE principal_type = 'guest' AND principal_id = $1`,
      [guestInstallationId],
    );
  }

  /**
   * Provider-derived grants keep their source key once the ledger row goes.
   * The key names the store transaction rather than the erased identity, so
   * the same purchase can never mint Stitch Coin, AI Credit, or Membership
   * Credit again for the fresh installation that restores it.
   */
  private async tombstoneProviderGrants(
    manager: EntityManager,
    guestInstallationId: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO economy.commerce_grant_tombstones (source_key)
       SELECT source_key
       FROM economy.coin_ledger_entries
       WHERE principal_type = 'guest' AND principal_id = $1
         AND granted = true
         AND (source_key LIKE 'commerce:%' OR source_key LIKE 'membership:%')
       UNION
       SELECT source_key
       FROM economy.ai_credit_ledger_entries
       WHERE principal_type = 'guest' AND principal_id = $1
         AND granted = true
         AND (source_key LIKE 'commerce:%' OR source_key LIKE 'membership:%')
       ON CONFLICT ON CONSTRAINT "PK_commerce_grant_tombstones" DO NOTHING`,
      [guestInstallationId],
    );
  }

  /**
   * A daily claim is keyed by the claiming identity, which the reset erases.
   * Re-anchor the claimed days to the subscription that earned them, so a
   * restored Premium Membership cannot claim the same reward day twice.
   */
  private async tombstonePremiumDailyClaims(
    manager: EntityManager,
    guestInstallationId: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO economy.commerce_grant_tombstones (source_key)
       SELECT DISTINCT 'premium_daily:' || period.environment || ':'
                       || period.provider_transaction_id || ':'
                       || split_part(entry.source_key, ':', 4)
       FROM economy.coin_ledger_entries entry
       JOIN economy.membership_periods period
         ON period.guest_installation_id = $1
       WHERE entry.principal_type = 'guest' AND entry.principal_id = $1
         AND entry.reason = $2
       ON CONFLICT ON CONSTRAINT "PK_commerce_grant_tombstones" DO NOTHING`,
      [guestInstallationId, CoinLedgerReason.PremiumDailyClaim],
    );
  }
}
