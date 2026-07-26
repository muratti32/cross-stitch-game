import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { storedPatternObjectKeys } from '../catalog/pattern-object-keys';
import { OBJECT_STORAGE, ObjectStorage } from '../catalog/storage/object-storage.interface';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import { PrincipalType } from '../auth/entities';
import { AccountStateService } from './account-state.service';

@Injectable()
export class AccountDeletionFinalizerService {
  private readonly logger = new Logger(AccountDeletionFinalizerService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly accountStateService: AccountStateService,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
  ) {}

  async findDueRequestIds(limit: number): Promise<string[]> {
    const rows = await this.dataSource.query<readonly { id: string }[]>(
      `SELECT id FROM deletion.account_deletion_requests
       WHERE status = 'pending' AND recovery_window_ends_at <= now()
       ORDER BY recovery_window_ends_at ASC, id ASC
       LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.id);
  }

  async finalizeDueRequests(limit = 25): Promise<number> {
    try {
      await this.dataSource.query(
        `DELETE FROM "deletion"."invalidated_namespace_tokens"
         WHERE "token_hash" IN (
           SELECT "token_hash" FROM "deletion"."invalidated_namespace_tokens"
           WHERE "expires_at" < now()
           LIMIT 1000
         )`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to purge expired namespace tokens: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    const dueIds = await this.findDueRequestIds(limit);
    let finalizedCount = 0;
    for (const requestId of dueIds) {
      try {
        await this.finalizeOne(requestId);
        finalizedCount++;
      } catch (error: unknown) {
        this.logger.error(
          `Failed to finalize account deletion request ${requestId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return finalizedCount;
  }

  async finalizeOne(requestId: string): Promise<void> {
    const keysToDelete: string[] = [];

    await this.dataSource.transaction(async (manager) => {
      const requests = await manager.query<
        readonly { id: string; account_id: string; status: string }[]
      >(
        `SELECT id, account_id, status FROM deletion.account_deletion_requests
         WHERE id = $1 FOR UPDATE`,
        [requestId],
      );

      const request = requests[0];
      if (request === undefined || request.status !== 'pending') {
        return;
      }

      const accountId = request.account_id;

      // 1. Gather all object storage keys first (inside transaction)
      const artworks = await manager.query<readonly { image_object_key: string | null }[]>(
        `SELECT image_object_key FROM ai.ai_artworks WHERE account_id = $1`,
        [accountId],
      );
      for (const a of artworks) {
        if (a.image_object_key) {
          keysToDelete.push(a.image_object_key);
        }
      }

      const conversions = await manager.query<readonly { upload_object_key: string }[]>(
        `SELECT upload_object_key FROM conversion.pattern_conversions WHERE account_id = $1`,
        [accountId],
      );
      for (const c of conversions) {
        if (c.upload_object_key) {
          keysToDelete.push(c.upload_object_key);
        }
      }

      const personalPatterns = await manager.query<
        readonly {
          id: string;
          artifact_object_key: string;
          preview_object_key: string;
          thumbnail_renderer_version: number | null;
        }[]
      >(
        `SELECT id, artifact_object_key, preview_object_key, thumbnail_renderer_version FROM catalog.patterns
         WHERE visibility = 'personal' AND owner_account_id = $1`,
        [accountId],
      );
      for (const p of personalPatterns) {
        keysToDelete.push(
          ...storedPatternObjectKeys({
            artifactObjectKey: p.artifact_object_key,
            id: p.id,
            previewObjectKey: p.preview_object_key,
            thumbnailRendererVersion: p.thumbnail_renderer_version,
            visibility: 'personal',
          }),
        );
      }

      const profiles = await manager.query<readonly { avatar_object_key: string | null }[]>(
        `SELECT avatar_object_key FROM moderation.creator_profiles WHERE account_id = $1`,
        [accountId],
      );
      for (const p of profiles) {
        if (p.avatar_object_key) {
          keysToDelete.push(p.avatar_object_key);
        }
      }

      // 2. Fetch counts before we delete/update for audit logs
      const countAuthIdentities = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM auth.auth_identities WHERE account_id = $1`,
        [accountId],
      );
      const countEmailCodes = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM auth.email_verification_codes
         WHERE email IN (SELECT email FROM auth.auth_identities WHERE account_id = $1)`,
        [accountId],
      );
      const countRefreshTokens = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM auth.refresh_tokens
         WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      const countArtworks = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM ai.ai_artworks WHERE account_id = $1`,
        [accountId],
      );
      const countReservations = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM ai.ai_credit_reservations WHERE account_id = $1`,
        [accountId],
      );
      const countPersonalPatterns = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM catalog.patterns
         WHERE visibility = 'personal' AND owner_account_id = $1`,
        [accountId],
      );
      const countPatternConversions = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM conversion.pattern_conversions WHERE account_id = $1`,
        [accountId],
      );
      const countSessions = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM sessions.stitching_sessions
         WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      const countLikes = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM social.pattern_likes WHERE account_id = $1`,
        [accountId],
      );
      const countBlocks = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM social.creator_blocks
         WHERE account_id = $1 OR creator_profile_id = (SELECT id FROM moderation.creator_profiles WHERE account_id = $1)`,
        [accountId],
      );
      const countUnlocks = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM economy.pattern_unlocks
         WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      const countCoins = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM economy.coin_balances
         WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      const countAiCredits = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM economy.ai_credit_balances
         WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      const countColorCounts = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM economy.daily_color_action_counts
         WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      const countPools = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM economy.reward_day_pools
         WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      const countGameplay = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM economy.gameplay_events
         WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      const countTransferPackages = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM promotion.transfer_packages
         WHERE account_id = $1 AND status IN ('staged', 'needs_attention')`,
        [accountId],
      );

      // PSEUDONYMIZE counts
      const countCreatorProfiles = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM moderation.creator_profiles WHERE account_id = $1`,
        [accountId],
      );
      const countCatalogPatterns = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM catalog.patterns
         WHERE creator_profile_id = (SELECT id FROM moderation.creator_profiles WHERE account_id = $1)
         AND visibility = 'catalog'`,
        [accountId],
      );
      const countSubmissions = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM catalog.catalog_submissions
         WHERE account_id = $1 AND status IN ('precheck_pending', 'review_pending', 'quarantined', 'appeal_pending')`,
        [accountId],
      );
      const countRevisions = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM catalog.catalog_metadata_revisions
         WHERE account_id = $1 AND status IN ('pending', 'appeal_pending')`,
        [accountId],
      );
      const countAppeals = await manager.query<readonly { count: string }[]>(
        `SELECT count(*)::text AS count FROM moderation.creator_profile_appeals
         WHERE account_id = $1 AND status = 'open'`,
        [accountId],
      );

      const details = {
        erased: {
          'auth.auth_identities': Number(countAuthIdentities[0]?.count ?? 0),
          'auth.email_verification_codes': Number(countEmailCodes[0]?.count ?? 0),
          'auth.refresh_tokens': Number(countRefreshTokens[0]?.count ?? 0),
          'deletion.invalidated_namespace_tokens': Number(countRefreshTokens[0]?.count ?? 0),
          'ai.ai_artworks': Number(countArtworks[0]?.count ?? 0),
          'ai.ai_credit_reservations': Number(countReservations[0]?.count ?? 0),
          'catalog.patterns_personal': Number(countPersonalPatterns[0]?.count ?? 0),
          'conversion.pattern_conversions': Number(countPatternConversions[0]?.count ?? 0),
          'sessions.stitching_sessions': Number(countSessions[0]?.count ?? 0),
          'social.pattern_likes': Number(countLikes[0]?.count ?? 0),
          'social.creator_blocks': Number(countBlocks[0]?.count ?? 0),
          'economy.pattern_unlocks': Number(countUnlocks[0]?.count ?? 0),
          'economy.coin_balances': Number(countCoins[0]?.count ?? 0),
          'economy.ai_credit_balances': Number(countAiCredits[0]?.count ?? 0),
          'economy.daily_color_action_counts': Number(countColorCounts[0]?.count ?? 0),
          'economy.reward_day_pools': Number(countPools[0]?.count ?? 0),
          'economy.gameplay_events': Number(countGameplay[0]?.count ?? 0),
        },
        pseudonymized: {
          'auth.registered_accounts': 1,
          'moderation.creator_profiles': Number(countCreatorProfiles[0]?.count ?? 0),
          'catalog.patterns_catalog': Number(countCatalogPatterns[0]?.count ?? 0),
          'catalog.catalog_submissions': Number(countSubmissions[0]?.count ?? 0),
          'catalog.catalog_metadata_revisions': Number(countRevisions[0]?.count ?? 0),
          'moderation.creator_profile_appeals': Number(countAppeals[0]?.count ?? 0),
          'promotion.transfer_packages_discarded': Number(countTransferPackages[0]?.count ?? 0),
        },
      };

      // 3. EXECUTE ERASE OPERATIONS (deletions)
      // Copy token hashes to invalidated namespace tokens first
      await manager.query(
        `INSERT INTO "deletion"."invalidated_namespace_tokens" ("token_hash", "expires_at")
         SELECT "token_hash", now() + interval '180 days'
         FROM "auth"."refresh_tokens"
         WHERE "principal_type" = 'account' AND "principal_id" = $1
         ON CONFLICT ("token_hash") DO NOTHING`,
        [accountId],
      );

      // Call token revocation first (using repository)
      await this.refreshTokensRepository.revokeAllForPrincipal(
        PrincipalType.Account,
        accountId,
      );

      // Erase email verification codes
      await manager.query(
        `DELETE FROM auth.email_verification_codes
         WHERE email IN (
           SELECT email FROM auth.auth_identities WHERE account_id = $1
         )`,
        [accountId],
      );

      // Erase auth identities
      await manager.query(
        `DELETE FROM auth.auth_identities WHERE account_id = $1`,
        [accountId],
      );

      // Erase refresh tokens
      await manager.query(
        `DELETE FROM auth.refresh_tokens WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );

      // Erase AI artworks and tombstones for unresolved provider requests
      const jobsToTombstone = await manager.query<
        readonly { provider_request_id: string; processing_job_id: string }[]
      >(
        `SELECT provider_request_id, processing_job_id FROM ai.ai_artworks
         WHERE account_id = $1 AND provider_request_id IS NOT NULL AND status IN ('pending', 'submitting', 'submitted')`,
        [accountId],
      );
      for (const job of jobsToTombstone) {
        await manager.query(
          `INSERT INTO deletion.provider_job_tombstones (provider, provider_request_id, processing_job_id)
           VALUES ('fal.ai', $1, $2)
           ON CONFLICT (provider, provider_request_id) DO NOTHING`,
          [job.provider_request_id, job.processing_job_id],
        );
      }

      await manager.query(
        `DELETE FROM ai.ai_credit_reservations WHERE account_id = $1`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM ai.ai_artworks WHERE account_id = $1`,
        [accountId],
      );

      // Erase personal patterns & conversions
      await manager.query(
        `DELETE FROM conversion.pattern_conversions WHERE account_id = $1`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM conversion.personal_patterns WHERE owner_account_id = $1`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM catalog.patterns WHERE visibility = 'personal' AND owner_account_id = $1`,
        [accountId],
      );

      // Erase stitching sessions and all children
      await manager.query(
        `DELETE FROM sessions.progress_operations
         WHERE session_id IN (SELECT id FROM sessions.stitching_sessions WHERE principal_type = 'account' AND principal_id = $1)`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM sessions.session_checkpoints
         WHERE session_id IN (SELECT id FROM sessions.stitching_sessions WHERE principal_type = 'account' AND principal_id = $1)`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM sessions.session_device_watermarks
         WHERE session_id IN (SELECT id FROM sessions.stitching_sessions WHERE principal_type = 'account' AND principal_id = $1)`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM sessions.session_cell_state
         WHERE session_id IN (SELECT id FROM sessions.stitching_sessions WHERE principal_type = 'account' AND principal_id = $1)`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM sessions.session_sync_state
         WHERE session_id IN (SELECT id FROM sessions.stitching_sessions WHERE principal_type = 'account' AND principal_id = $1)`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM sessions.session_progress_flags
         WHERE session_id IN (SELECT id FROM sessions.stitching_sessions WHERE principal_type = 'account' AND principal_id = $1)`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM sessions.stitching_sessions WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );

      // Erase likes & decrement like counts
      const likedPatterns = await manager.query<readonly { pattern_id: string }[]>(
        `SELECT pattern_id FROM social.pattern_likes WHERE account_id = $1`,
        [accountId],
      );
      for (const liked of likedPatterns) {
        await manager.query(
          `UPDATE catalog.patterns SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1`,
          [liked.pattern_id],
        );
      }
      await manager.query(
        `DELETE FROM social.pattern_likes WHERE account_id = $1`,
        [accountId],
      );

      // Erase creator blocks
      await manager.query(
        `DELETE FROM social.creator_blocks
         WHERE account_id = $1 OR creator_profile_id = (
           SELECT id FROM moderation.creator_profiles WHERE account_id = $1
         )`,
        [accountId],
      );

      // Erase economy data
      await manager.query(
        `DELETE FROM economy.pattern_unlocks WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM economy.coin_balances WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM economy.ai_credit_balances WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM economy.daily_color_action_counts WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM economy.reward_day_pools WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );
      await manager.query(
        `DELETE FROM economy.gameplay_events WHERE principal_type = 'account' AND principal_id = $1`,
        [accountId],
      );

      // 4. DISCARD UNRESOLVED PROMOTION TRANSFER PACKAGES
      const unresolvedPackages = await manager.query<readonly { guest_id: string; checksum: string }[]>(
        `SELECT guest_id, checksum FROM promotion.transfer_packages
         WHERE account_id = $1 AND status IN ('staged', 'needs_attention')`,
        [accountId],
      );
      for (const pkg of unresolvedPackages) {
        await manager.query(
          `INSERT INTO deletion.deletion_audit_events (request_id, event, details)
           VALUES ($1, 'deletion_promotion_payload_discarded', $2::jsonb)`,
          [requestId, JSON.stringify({ guestId: pkg.guest_id, checksum: pkg.checksum })],
        );
      }
      await manager.query(
        `UPDATE promotion.transfer_packages
         SET status = 'cancelled'
         WHERE account_id = $1 AND status IN ('staged', 'needs_attention')`,
        [accountId],
      );

      // 5. EXECUTE PSEUDONYMIZE OPERATIONS
      // Pseudonymize registered_accounts status
      await manager.query(
        `UPDATE auth.registered_accounts SET status = 'deleted' WHERE id = $1`,
        [accountId],
      );

      // Fetch creator profile ID and username
      const profileRows = await manager.query<readonly { id: string; username: string }[]>(
        `SELECT id, username FROM moderation.creator_profiles WHERE account_id = $1`,
        [accountId],
      );
      const profile = profileRows[0];

      if (profile !== undefined) {
        // Permanent reservation of username
        await manager.query(
          `INSERT INTO moderation.reserved_usernames (username, profile_id)
           VALUES ($1, $2)
           ON CONFLICT (username) DO NOTHING`,
          [profile.username, profile.id],
        );

        // Pseudonymize creator profile
        await manager.query(
          `UPDATE moderation.creator_profiles
           SET display_name = 'Deleted Creator',
               avatar_object_key = NULL,
               avatar_content_type = NULL,
               avatar_checksum = NULL,
               closure_hold_at = NULL,
               deleted_at = now()
           WHERE account_id = $1`,
          [accountId],
        );

        // Pseudonymize patterns (visibility = catalog)
        await manager.query(
          `UPDATE catalog.patterns
           SET status = 'withdrawn', creator_name = 'Deleted Creator'
           WHERE creator_profile_id = $1 AND visibility = 'catalog'`,
          [profile.id],
        );
      }

      // Close pending catalog submissions, revisions, and appeals
      await manager.query(
        `UPDATE catalog.catalog_submissions
         SET status = 'rejected'
         WHERE account_id = $1 AND status IN ('precheck_pending', 'review_pending', 'quarantined', 'appeal_pending')`,
        [accountId],
      );
      await manager.query(
        `UPDATE catalog.catalog_metadata_revisions
         SET status = 'rejected'
         WHERE account_id = $1 AND status IN ('pending', 'appeal_pending')`,
        [accountId],
      );
      await manager.query(
        `UPDATE moderation.creator_profile_appeals
         SET status = 'dismissed'
         WHERE account_id = $1 AND status = 'open'`,
        [accountId],
      );

      // 6. SET ACCOUNT DELETION REQUEST AS FINALIZED
      await manager.query(
        `UPDATE deletion.account_deletion_requests
         SET status = 'finalized', finalized_at = now()
         WHERE id = $1`,
        [requestId],
      );

      // Write deletion_finalized event
      await manager.query(
        `INSERT INTO deletion.deletion_audit_events (request_id, event, details)
         VALUES ($1, 'deletion_finalized', $2::jsonb)`,
        [requestId, JSON.stringify(details)],
      );

      // Invalidate status cache
      this.accountStateService.invalidate(accountId);
    });

    // 7. Perform physical object storage deletion AFTER transaction commit
    for (const key of keysToDelete) {
      try {
        await this.objectStorage.delete(key);
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to delete object storage key ${key} during finalization of request ${requestId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
