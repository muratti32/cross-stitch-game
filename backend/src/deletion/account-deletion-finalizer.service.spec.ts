import type { DataSource, EntityManager } from 'typeorm';

import { PrincipalType } from '../auth/entities';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import type { ObjectStorage } from '../catalog/storage/object-storage.interface';
import { AccountDeletionFinalizerService } from './account-deletion-finalizer.service';
import { AccountStateService } from './account-state.service';

describe('AccountDeletionFinalizerService', () => {
  let queryMock: jest.Mock;
  let transactionMock: jest.Mock;
  let managerQueryMock: jest.Mock;
  let revokeAllForPrincipalMock: jest.Mock;
  let invalidateMock: jest.Mock;
  let objectStorageDeleteMock: jest.Mock;
  let service: AccountDeletionFinalizerService;
  let requestStatus: string;

  beforeEach(() => {
    requestStatus = 'pending';
    queryMock = jest.fn();
    managerQueryMock = jest.fn();

    transactionMock = jest.fn().mockImplementation((cb: (manager: EntityManager) => Promise<unknown>) => {
      const fakeManager = {
        query: managerQueryMock,
      } as unknown as EntityManager;
      return cb(fakeManager);
    });

    revokeAllForPrincipalMock = jest.fn().mockResolvedValue(undefined);
    invalidateMock = jest.fn();
    objectStorageDeleteMock = jest.fn().mockResolvedValue(undefined);

    const dataSource = {
      query: queryMock,
      transaction: transactionMock,
    } as unknown as DataSource;

    const refreshTokensRepository = {
      revokeAllForPrincipal: revokeAllForPrincipalMock,
    } as unknown as RefreshTokensRepository;

    const accountStateService = {
      invalidate: invalidateMock,
    } as unknown as AccountStateService;

    const objectStorage = {
      delete: objectStorageDeleteMock,
    } as unknown as ObjectStorage;

    service = new AccountDeletionFinalizerService(
      dataSource,
      refreshTokensRepository,
      accountStateService,
      objectStorage,
    );

    // Setup default manager query responses
    managerQueryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      await Promise.resolve();
      const cleanSql = sql.replace(/\s+/g, ' ').trim();
      if (cleanSql.includes('SELECT id, account_id, status FROM deletion.account_deletion_requests')) {
        return [{ id: params?.[0], account_id: 'acc-1', status: requestStatus }];
      }
      if (cleanSql.includes('SELECT image_object_key FROM ai.ai_artworks')) {
        return [{ image_object_key: 'key-artwork' }];
      }
      if (cleanSql.includes('SELECT upload_object_key FROM conversion.pattern_conversions')) {
        return [{ upload_object_key: 'key-conversion' }];
      }
      if (cleanSql.includes('SELECT artifact_object_key, preview_object_key FROM catalog.patterns')) {
        return [{ artifact_object_key: 'key-art', preview_object_key: 'key-prev' }];
      }
      if (cleanSql.includes('SELECT avatar_object_key FROM moderation.creator_profiles')) {
        return [{ avatar_object_key: 'key-avatar' }];
      }
      if (cleanSql.includes('SELECT id, username FROM moderation.creator_profiles')) {
        return [{ id: 'prof-1', username: 'testuser' }];
      }
      if (cleanSql.includes('SELECT provider_request_id, processing_job_id FROM ai.ai_artworks')) {
        return [{ provider_request_id: 'req-fal', processing_job_id: 'job-fal' }];
      }
      if (cleanSql.includes('SELECT pattern_id FROM social.pattern_likes')) {
        return [{ pattern_id: 'pat-liked' }];
      }
      if (cleanSql.includes('SELECT guest_id, checksum FROM promotion.transfer_packages')) {
        return [{ guest_id: 'guest-1', checksum: 'check-1' }];
      }
      // Count queries
      if (cleanSql.includes('SELECT count(*)::text')) {
        return [{ count: '1' }];
      }
      return [];
    });
  });

  it('only requests past recovery_window_ends_at are picked up', async () => {
    queryMock.mockResolvedValue([{ id: 'req-1' }, { id: 'req-2' }]);
    const ids = await service.findDueRequestIds(10);
    expect(ids).toEqual(['req-1', 'req-2']);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'pending' AND recovery_window_ends_at <= now()"),
      [10],
    );
  });

  it('an already-finalized request is a no-op', async () => {
    requestStatus = 'finalized';
    await service.finalizeOne('req-1');

    // No updates or deletions should run if the request is not pending
    expect(revokeAllForPrincipalMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('Community Patterns become withdrawn and are NOT deleted, while personal patterns are deleted', async () => {
    await service.finalizeOne('req-1');

    // Verification of withdrawals (community pattern updates status)
    expect(managerQueryMock).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE catalog\.patterns\s+SET status = 'withdrawn'/),
      ['prof-1'],
    );

    // Verification of deletions (personal patterns only)
    expect(managerQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM catalog.patterns WHERE visibility = 'personal' AND owner_account_id = $1"),
      ['acc-1'],
    );
  });

  it('the username is inserted into reserved_usernames and the profile keeps its id', async () => {
    await service.finalizeOne('req-1');

    expect(managerQueryMock).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO moderation\.reserved_usernames\s+\(username, profile_id\)/),
      ['testuser', 'prof-1'],
    );

    expect(managerQueryMock).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE moderation\.creator_profiles\s+SET display_name = 'Deleted Creator'/),
      ['acc-1'],
    );
  });

  it('like aggregates are decremented once per like', async () => {
    await service.finalizeOne('req-1');

    expect(managerQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE catalog.patterns SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1"),
      ['pat-liked'],
    );
  });

  it('balances and unlocks are erased (forfeit) while commerce_transaction_bindings is never touched', async () => {
    await service.finalizeOne('req-1');

    expect(managerQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM economy.pattern_unlocks WHERE principal_type = 'account' AND principal_id = $1"),
      ['acc-1'],
    );
    expect(managerQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM economy.coin_balances WHERE principal_type = 'account' AND principal_id = $1"),
      ['acc-1'],
    );

    // Ensure commerce_transaction_bindings was not deleted or modified
    for (const call of managerQueryMock.mock.calls as [string, unknown[]][]) {
      expect(call[0]).not.toContain('commerce_transaction_bindings');
    }
  });

  it('an unresolved provider job produces a tombstone before the artwork is erased', async () => {
    await service.finalizeOne('req-1');

    expect(managerQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO deletion.provider_job_tombstones (provider, provider_request_id, processing_job_id)"),
      ['req-fal', 'job-fal'],
    );
    expect(managerQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM ai.ai_artworks WHERE account_id = $1"),
      ['acc-1'],
    );
  });

  it('storage deletes happen after the commit and a storage failure does not fail the finalization', async () => {
    objectStorageDeleteMock.mockRejectedValue(new Error('Object storage delete failed'));
    await expect(service.finalizeOne('req-1')).resolves.not.toThrow();

    expect(objectStorageDeleteMock).toHaveBeenCalledWith('key-artwork');
    expect(objectStorageDeleteMock).toHaveBeenCalledWith('key-conversion');
    expect(objectStorageDeleteMock).toHaveBeenCalledWith('key-art');
    expect(objectStorageDeleteMock).toHaveBeenCalledWith('key-prev');
    expect(objectStorageDeleteMock).toHaveBeenCalledWith('key-avatar');
  });

  it('sessions are revoked', async () => {
    await service.finalizeOne('req-1');

    expect(revokeAllForPrincipalMock).toHaveBeenCalledWith(PrincipalType.Account, 'acc-1');
    expect(managerQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM auth.refresh_tokens WHERE principal_type = 'account' AND principal_id = $1"),
      ['acc-1'],
    );
  });
});
