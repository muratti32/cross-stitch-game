import { DataSource, EntityManager, In } from 'typeorm';
import { AccountClosureWorkloadService } from './account-closure-workload.service';
import { AiArtworkEntity, AiCreditReservationEntity } from '../ai-artwork/entities';
import { PromotionTransferPackageEntity, PromotionLockEntity } from '../promotion/entities';

describe('AccountClosureWorkloadService', () => {
  let service: AccountClosureWorkloadService;
  let dataSource: DataSource;
  let manager: EntityManager;

  let aiArtworkRepo: {
    find: jest.Mock;
    update: jest.Mock;
  };
  let aiCreditRepo: {
    update: jest.Mock;
  };
  let transferPackageRepo: {
    find: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let lockRepo: {
    delete: jest.Mock;
  };

  let queryMock: jest.Mock;

  beforeEach(() => {
    queryMock = jest.fn();

    aiArtworkRepo = {
      find: jest.fn(),
      update: jest.fn(),
    };

    aiCreditRepo = {
      update: jest.fn(),
    };

    transferPackageRepo = {
      find: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };

    lockRepo = {
      delete: jest.fn(),
    };

    manager = {
      getRepository: jest.fn().mockImplementation((entity: unknown) => {
        if (entity === AiArtworkEntity) return aiArtworkRepo;
        if (entity === AiCreditReservationEntity) return aiCreditRepo;
        if (entity === PromotionTransferPackageEntity) return transferPackageRepo;
        if (entity === PromotionLockEntity) return lockRepo;
        return null;
      }),
      query: queryMock,
      save: jest.fn().mockImplementation((entity: unknown, val: unknown) => {
        if (entity === PromotionTransferPackageEntity) return transferPackageRepo.save(val) as unknown;
        return null;
      }),
      delete: jest.fn().mockImplementation((entity: unknown, val: unknown) => {
        if (entity === PromotionTransferPackageEntity) return transferPackageRepo.delete(val) as unknown;
        if (entity === PromotionLockEntity) return lockRepo.delete(val) as unknown;
        return null;
      }),
    } as unknown as EntityManager;

    dataSource = {} as unknown as DataSource;
    service = new AccountClosureWorkloadService(dataSource);
  });

  it('cancels unsubmitted artwork, releases reservation, fails processing job, and cancels staged transfer packages', async () => {
    const accountId = 'test-account-id';

    const mockArtwork = {
      id: 'artwork-1',
      processingJobId: 'job-1',
      status: 'pending',
      providerRequestId: null,
    };
    aiArtworkRepo.find.mockResolvedValue([mockArtwork]);

    const mockPackage = {
      guestId: 'guest-1',
      accountId,
      status: 'staged',
    };
    transferPackageRepo.find.mockResolvedValue([mockPackage]);

    queryMock.mockResolvedValue({ affected: 1 });

    const result = await service.cancelUnsubmittedWork(accountId, manager);

    expect(result).toEqual({
      artworks: 1,
      promotions: 1,
    });

    expect(aiArtworkRepo.find).toHaveBeenCalledWith({
      where: {
        accountId,
        status: 'pending',
        providerRequestId: expect.any(Object) as unknown,
      },
    });
    expect(aiArtworkRepo.update).toHaveBeenCalledWith(
      { id: In(['artwork-1']) },
      { status: 'cancelled', failureReason: 'account_deletion' }
    );
    expect(aiCreditRepo.update).toHaveBeenCalledWith(
      { processingJobId: In(['job-1']) },
      { status: 'released' }
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
    const queryCalls = queryMock.mock.calls as unknown as [string, unknown[]][];
    expect(queryCalls[0][0]).toContain('UPDATE jobs.processing_jobs');
    expect(queryCalls[0][1]).toEqual(['account_deletion', ['job-1']]);

    expect(transferPackageRepo.find).toHaveBeenCalledWith({
      where: {
        accountId,
        status: 'staged',
      },
    });
    expect(lockRepo.delete).toHaveBeenCalledWith({ guestId: 'guest-1' });
    expect(manager.save).toHaveBeenCalledWith(PromotionTransferPackageEntity, expect.objectContaining({
      guestId: 'guest-1',
      status: 'cancelled',
    }));
    expect(manager.delete).toHaveBeenCalledWith(PromotionTransferPackageEntity, { guestId: 'guest-1' });
  });

  it('does not touch submitted artworks (with providerRequestId) or committed promotions', async () => {
    const accountId = 'test-account-id';

    aiArtworkRepo.find.mockResolvedValue([]);
    transferPackageRepo.find.mockResolvedValue([]);

    const result = await service.cancelUnsubmittedWork(accountId, manager);

    expect(result).toEqual({
      artworks: 0,
      promotions: 0,
    });

    expect(aiArtworkRepo.update).not.toHaveBeenCalled();
    expect(aiCreditRepo.update).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(lockRepo.delete).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
  });
});
