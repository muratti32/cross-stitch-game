import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AiArtworkService } from './ai-artwork.service';
import { AccountStateService } from '../deletion/account-state.service';
import { PrincipalType } from '../auth/entities';
import { AuthPrincipal } from '../auth/auth.types';
import { AiArtworkEntity, AiCreditReservationEntity } from './entities';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository';
import { PromptModerationService } from './prompt-moderation.service';
import { FalArtworkProviderService } from './fal-artwork-provider.service';
import { ConversionService } from '../conversion/conversion.service';
import { SupportReferenceService } from '../support/support-reference.service';
import { ObjectStorage } from '../catalog/storage/object-storage.interface';
import { ApproveAiArtworkDto } from './dto/approve-ai-artwork.dto';

describe('AiArtworkService - Account Closing Behaviors', () => {
  let service: AiArtworkService;
  
  let accountStateServiceMock: {
    getAccountStatus: jest.Mock;
  };
  let artworksRepoMock: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    update: jest.Mock;
  };
  let jobsRepoMock: {
    findById: jest.Mock;
    failFromRunning: jest.Mock;
  };
  let dataSourceMock: {
    transaction: jest.Mock;
    query: jest.Mock;
  };
  let moderationMock: Record<string, never>;
  let falMock: {
    result: jest.Mock;
  };
  let conversionsMock: {
    createPhotoConversion: jest.Mock;
  };
  let supportReferencesMock: {
    findCodesForRecords: jest.Mock;
    findCodeForRecord: jest.Mock;
  };
  let storageMock: {
    get: jest.Mock;
  };

  beforeEach(() => {
    accountStateServiceMock = {
      getAccountStatus: jest.fn(),
    };

    artworksRepoMock = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    };

    jobsRepoMock = {
      findById: jest.fn(),
      failFromRunning: jest.fn().mockResolvedValue(true),
    };

    const fakeReservationRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'res-id', status: 'reserved' }),
      update: jest.fn().mockResolvedValue({}),
    };

    const fakeManager = {
      getRepository: jest.fn().mockImplementation((entity: unknown) => {
        if (entity === AiArtworkEntity) return artworksRepoMock;
        if (entity === AiCreditReservationEntity) return fakeReservationRepo;
        return null;
      }),
    };

    dataSourceMock = {
      transaction: jest.fn().mockImplementation((cb: (manager: unknown) => Promise<unknown>) => cb(fakeManager)),
      query: jest.fn().mockResolvedValue([]),
    };
    moderationMock = {};
    falMock = {
      result: jest.fn(),
    };
    conversionsMock = {
      createPhotoConversion: jest.fn(),
    };
    supportReferencesMock = {
      findCodesForRecords: jest.fn(),
      findCodeForRecord: jest.fn(),
    };
    storageMock = {
      get: jest.fn(),
    };

    service = new AiArtworkService(
      dataSourceMock as unknown as DataSource,
      jobsRepoMock as unknown as ProcessingJobsRepository,
      moderationMock as unknown as PromptModerationService,
      falMock as unknown as FalArtworkProviderService,
      conversionsMock as unknown as ConversionService,
      supportReferencesMock as unknown as SupportReferenceService,
      storageMock as unknown as ObjectStorage,
      artworksRepoMock as unknown as Repository<AiArtworkEntity>,
      accountStateServiceMock as unknown as AccountStateService,
    );
  });

  const getAccountPrincipal = (): AuthPrincipal => ({
    id: 'test-account-id',
    tokenVersion: 1,
    type: PrincipalType.Account,
  });

  describe('list', () => {
    it('returns empty array when account is closing', async () => {
      accountStateServiceMock.getAccountStatus.mockResolvedValue('closing');

      const principal = getAccountPrincipal();
      const result = await service.list(principal);

      expect(result).toEqual([]);
      expect(accountStateServiceMock.getAccountStatus).toHaveBeenCalledWith('test-account-id');
      expect(artworksRepoMock.find).not.toHaveBeenCalled();
    });

    it('runs normally when account is active', async () => {
      accountStateServiceMock.getAccountStatus.mockResolvedValue('active');
      artworksRepoMock.find.mockResolvedValue([]);

      const principal = getAccountPrincipal();
      const result = await service.list(principal);

      expect(result).toEqual([]);
      expect(artworksRepoMock.find).toHaveBeenCalled();
    });
  });

  describe('getJob', () => {
    it('throws NotFoundException when account is closing', async () => {
      accountStateServiceMock.getAccountStatus.mockResolvedValue('closing');

      const principal = getAccountPrincipal();
      await expect(service.getJob(principal, 'job-id')).rejects.toThrow(NotFoundException);
      expect(artworksRepoMock.findOneBy).not.toHaveBeenCalled();
    });

    it('runs normally when account is active', async () => {
      accountStateServiceMock.getAccountStatus.mockResolvedValue('active');
      const mockArtwork = {
        id: 'artwork-id',
        accountId: 'test-account-id',
        processingJobId: 'job-id',
        createdAt: new Date(),
        status: 'pending',
      };
      artworksRepoMock.findOneBy.mockResolvedValue(mockArtwork);
      jobsRepoMock.findById.mockResolvedValue({ status: 'pending', errorMessage: null });
      supportReferencesMock.findCodeForRecord.mockResolvedValue('ref-code');

      const principal = getAccountPrincipal();
      const result = await service.getJob(principal, 'artwork-id');

      expect(result).toBeDefined();
      expect(result.id).toBe('artwork-id');
      expect(artworksRepoMock.findOneBy).toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    it('throws ForbiddenException when account is closing', async () => {
      accountStateServiceMock.getAccountStatus.mockResolvedValue('closing');

      const principal = getAccountPrincipal();
      await expect(service.approve(principal, 'artwork-id', {} as unknown as ApproveAiArtworkDto)).rejects.toThrow(ForbiddenException);
      expect(artworksRepoMock.findOneBy).not.toHaveBeenCalled();
    });

    it('runs normally when account is active', async () => {
      accountStateServiceMock.getAccountStatus.mockResolvedValue('active');
      const mockArtwork = {
        id: 'artwork-id',
        accountId: 'test-account-id',
        status: 'delivered',
        imageObjectKey: 'key',
        imageContentType: 'image/png',
      };
      artworksRepoMock.findOneBy.mockResolvedValue(mockArtwork);
      storageMock.get.mockResolvedValue(Buffer.from('hello'));
      conversionsMock.createPhotoConversion.mockResolvedValue('conversion-result');

      const principal = getAccountPrincipal();
      const result = await service.approve(principal, 'artwork-id', {} as unknown as ApproveAiArtworkDto);

      expect(result).toBe('conversion-result');
      expect(conversionsMock.createPhotoConversion).toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    it('still executes successfully for closing accounts without checking accountStateService', async () => {
      const mockArtwork = {
        id: 'artwork-id',
        accountId: 'test-account-id',
        status: 'submitted',
        providerRequestId: 'request-id',
      };
      artworksRepoMock.findOneBy.mockResolvedValue(mockArtwork);
      falMock.result.mockResolvedValue({ failed: true });

      await service.reconcile('request-id');

      expect(artworksRepoMock.findOneBy).toHaveBeenCalled();
      expect(falMock.result).toHaveBeenCalledWith('request-id');
      expect(accountStateServiceMock.getAccountStatus).not.toHaveBeenCalled();
    });
  });
});
