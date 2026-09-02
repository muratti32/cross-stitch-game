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
import { AppConfigService } from '../config/app-config.service';

describe('AiArtworkService - Account Closing Behaviors', () => {
  let service: AiArtworkService;
  
  let accountStateServiceMock: {
    getAccountStatus: jest.Mock;
  };
  let artworksRepoMock: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneBy: jest.Mock;
    update: jest.Mock;
  };
  let jobsRepoMock: {
    findById: jest.Mock;
    failFromRunning: jest.Mock;
    completeFromRunning: jest.Mock;
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
    put: jest.Mock;
    exists: jest.Mock;
  };

  beforeEach(() => {
    accountStateServiceMock = {
      getAccountStatus: jest.fn(),
    };

    artworksRepoMock = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    };

    jobsRepoMock = {
      findById: jest.fn(),
      failFromRunning: jest.fn().mockResolvedValue(true),
      completeFromRunning: jest.fn().mockResolvedValue(true),
    };

    const fakeReservationRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'res-id', status: 'reserved' }),
      update: jest.fn().mockResolvedValue({}),
    };

    const fakeManager = {
      query: jest.fn().mockResolvedValue([]),
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
      put: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
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
      { grantSigningSecret: 'test-signing-secret' } as AppConfigService,
    );
  });

  const getAccountPrincipal = (): AuthPrincipal => ({
    id: 'test-account-id',
    tokenVersion: 1,
    type: PrincipalType.Account,
  });

  const getGuestPrincipal = (): AuthPrincipal => ({
    id: 'test-guest-id',
    tokenVersion: 1,
    type: PrincipalType.Guest,
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

    it('scopes Guest AI Artwork reads to the Guest Installation Identity', async () => {
      artworksRepoMock.find.mockResolvedValue([]);

      await expect(service.list(getGuestPrincipal())).resolves.toEqual([]);

      expect(accountStateServiceMock.getAccountStatus).not.toHaveBeenCalled();
      expect(artworksRepoMock.find).toHaveBeenCalledWith(expect.objectContaining({
        where: { guestInstallationId: 'test-guest-id' },
      }));
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

    it('approves only a delivered AI Artwork owned by the Guest Installation Identity', async () => {
      artworksRepoMock.findOneBy.mockResolvedValue({
        id: 'artwork-id',
        guestInstallationId: 'test-guest-id',
        status: 'delivered',
        imageObjectKey: 'key',
        imageContentType: 'image/png',
      });
      storageMock.get.mockResolvedValue(Buffer.from('hello'));
      conversionsMock.createPhotoConversion.mockResolvedValue('conversion-result');

      await expect(service.approve(getGuestPrincipal(), 'artwork-id', {} as unknown as ApproveAiArtworkDto))
        .resolves.toBe('conversion-result');
      expect(artworksRepoMock.findOneBy).toHaveBeenCalledWith({
        id: 'artwork-id',
        guestInstallationId: 'test-guest-id',
      });
    });
  });

  // Issue #64 split the fal.ai webhook into verifyWebhookKey +
  // handleVerifiedWebhook so the delivery can be archived between the two. These
  // cover the semantics that split must preserve.
  describe('fal.ai webhook verification and idempotency', () => {
    it('accepts a delivery whose artwork row is already gone instead of rejecting it', async () => {
      artworksRepoMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.verifyWebhookKey('job-id', 'request-key'),
      ).resolves.toBeUndefined();
    });

    it('rejects a delivery whose key contradicts the stored artwork', async () => {
      artworksRepoMock.findOneBy.mockResolvedValue({
        processingJobId: 'job-id',
        providerRequestKey: 'real-key',
      });

      await expect(
        service.verifyWebhookKey('job-id', 'forged-key'),
      ).rejects.toThrow(NotFoundException);
    });

    it('reports a tombstoned delivery as a duplicate without reprocessing it', async () => {
      dataSourceMock.query.mockResolvedValue([{ id: 'tombstone-id' }]);

      await expect(
        service.handleVerifiedWebhook('job-id', 'request-id'),
      ).resolves.toBe(true);
      expect(falMock.result).not.toHaveBeenCalled();
    });

    it('reports an already-attached delivery as a duplicate', async () => {
      dataSourceMock.query.mockResolvedValue([]);
      const artwork = {
        id: 'artwork-id',
        processingJobId: 'job-id',
        providerRequestId: 'request-id',
        status: 'submitted',
      };
      artworksRepoMock.findOneBy.mockResolvedValue(artwork);
      artworksRepoMock.findOne.mockResolvedValue(artwork);
      falMock.result.mockResolvedValue({ failed: true });

      await expect(
        service.handleVerifiedWebhook('job-id', 'request-id'),
      ).resolves.toBe(true);
    });

    it('reports a first delivery as processed', async () => {
      dataSourceMock.query.mockResolvedValue([]);
      const artwork = {
        id: 'artwork-id',
        processingJobId: 'job-id',
        providerRequestId: null,
        status: 'submitting',
      };
      artworksRepoMock.findOneBy.mockResolvedValue(artwork);
      artworksRepoMock.findOne.mockResolvedValue(artwork);
      falMock.result.mockResolvedValue({ failed: true });

      await expect(
        service.handleVerifiedWebhook('job-id', 'request-id'),
      ).resolves.toBe(false);
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

    // Issue #223: an artwork that never leaves `submitted` is retried by the
    // worker poll, and each pass used to re-upload the provider output, which
    // is a Class A object storage write.
    it('copies the provider output when the bucket has no object for the artwork yet', async () => {
      mockDeliverableArtwork();

      await service.reconcile('request-id');

      expect(storageMock.put).toHaveBeenCalledWith(
        'ai-artworks/test-account-id/artwork-id/source',
        expect.any(Buffer),
        'image/png',
      );
    });

    it('does not re-upload the provider output when the object is already in the bucket', async () => {
      mockDeliverableArtwork();
      storageMock.exists.mockResolvedValue(true);

      await service.reconcile('request-id');

      expect(storageMock.exists).toHaveBeenCalledWith(
        'ai-artworks/test-account-id/artwork-id/source',
      );
      expect(storageMock.put).not.toHaveBeenCalled();
    });

    it('does not touch object storage for an artwork the owner deleted', async () => {
      mockDeliverableArtwork();
      artworksRepoMock.findOneBy.mockResolvedValue({
        id: 'artwork-id',
        accountId: 'test-account-id',
        guestInstallationId: null,
        processingJobId: 'job-id',
        providerRequestId: 'request-id',
        status: 'deleted',
      });

      await service.reconcile('request-id');

      expect(falMock.result).not.toHaveBeenCalled();
      expect(storageMock.exists).not.toHaveBeenCalled();
      expect(storageMock.put).not.toHaveBeenCalled();
    });
  });

  function mockDeliverableArtwork(): void {
    const artwork = {
      id: 'artwork-id',
      accountId: 'test-account-id',
      guestInstallationId: null,
      processingJobId: 'job-id',
      providerRequestId: 'request-id',
      status: 'submitted',
    };
    artworksRepoMock.findOneBy.mockResolvedValue(artwork);
    artworksRepoMock.findOne.mockResolvedValue(artwork);
    falMock.result.mockResolvedValue({ unsafe: false, url: 'https://fal.example/output.png' });
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/png' },
    }) as unknown as typeof fetch;
  }
});
