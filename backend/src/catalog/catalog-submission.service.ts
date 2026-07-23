import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, In } from 'typeorm';

import { OperatorAuditLogEntity } from '../admin/entities';
import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { CreatorProfileEntity } from '../creator-profile/entities';
import { CATALOG_PRECHECK_EVENT_NAME, CATALOG_PRECHECK_JOB_TYPE } from '../jobs/jobs.constants';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository';
import { ObjectRegistryEntity } from '../sessions/entities';
import { CatalogPrecheckService } from './catalog-precheck.service';
import { CreateCatalogAppealDto } from './dto/create-catalog-appeal.dto';
import { CreateCatalogSubmissionDto } from './dto/create-catalog-submission.dto';
import {
  CatalogAppealEntity,
  CatalogRejectionReason,
  CatalogReviewDecisionEntity,
  CatalogSubmissionEntity,
  CategoryEntity,
  PatternEntity,
  TagEntity,
} from './entities';
import { OBJECT_STORAGE, ObjectStorage } from './storage/object-storage.interface';

export const CATALOG_PUBLICATION_LICENSE_VERSION = 'v1' as const;

@Injectable()
export class CatalogSubmissionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jobs: ProcessingJobsRepository,
    private readonly precheck: CatalogPrecheckService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async create(
    principal: AuthPrincipal,
    patternId: string,
    dto: CreateCatalogSubmissionDto,
  ) {
    const accountId = this.requireAccount(principal);
    if (!dto.rightsDeclared || dto.licenseVersion !== CATALOG_PUBLICATION_LICENSE_VERSION) {
      throw new BadRequestException('The current Publication Rights Declaration is required');
    }
    const [source, profile] = await Promise.all([
      this.dataSource.getRepository(PatternEntity).findOneBy({
        id: patternId,
        ownerAccountId: accountId,
        visibility: 'personal',
      }),
      this.dataSource.getRepository(CreatorProfileEntity).findOneBy({ accountId }),
    ]);
    if (source === null) throw new NotFoundException('Personal Pattern not found');
    if (profile === null) throw new ConflictException('Create a Public Creator Profile before submitting');

    const title = normalizeText(dto.title);
    const description = normalizeText(dto.description);
    if (title.length < 1 || title.length > 120 || description.length < 1 || description.length > 2000) {
      throw new BadRequestException('Catalog Submission text is outside the allowed length');
    }
    const submissionId = randomUUID();
    const processingJobId = randomUUID();
    const artifactObjectKey = `catalog-submissions/${submissionId}/artifact-v1.bin`;
    const previewObjectKey = `catalog-submissions/${submissionId}/preview.png`;
    const [artifact, preview] = await Promise.all([
      this.storage.get(source.artifactObjectKey),
      this.storage.get(source.previewObjectKey),
    ]);
    if (artifact === null || preview === null) {
      throw new ConflictException('Personal Pattern snapshot source is unavailable');
    }
    const artifactChecksum = sha256(artifact);
    if (artifactChecksum !== source.artifactChecksum.trim()) {
      throw new ConflictException('Personal Pattern artifact checksum is invalid');
    }
    const previewChecksum = sha256(preview);
    try {
      await Promise.all([
        this.stageSnapshotObject(artifactObjectKey, artifact, 'application/octet-stream'),
        this.stageSnapshotObject(previewObjectKey, preview, 'image/png'),
      ]);
      const submission = await this.dataSource.transaction(async (manager) => {
        const currentSource = await manager.getRepository(PatternEntity).findOne({
          lock: { mode: 'pessimistic_read' },
          where: { id: patternId, ownerAccountId: accountId, visibility: 'personal' },
        });
        if (currentSource === null || currentSource.artifactChecksum.trim() !== artifactChecksum) {
          throw new ConflictException('Personal Pattern changed before its snapshot was captured');
        }
        await this.jobs.createPendingWithOutboxFor(manager, {
          eventName: CATALOG_PRECHECK_EVENT_NAME,
          id: processingJobId,
          payload: { submissionId },
          type: CATALOG_PRECHECK_JOB_TYPE,
        });
        const created = await manager.getRepository(CatalogSubmissionEntity).save({
          accountId,
          artifactByteLength: artifact.length,
          artifactChecksum,
          artifactObjectKey,
          artifactSchemaVersion: source.artifactSchemaVersion,
          categoryCode: dto.categoryCode,
          creatorProfileId: profile.id,
          description,
          height: source.height,
          id: submissionId,
          licenseVersion: CATALOG_PUBLICATION_LICENSE_VERSION,
          paletteSize: source.paletteSize,
          previewChecksum,
          previewObjectKey,
          processingJobId,
          rightsDeclared: true,
          rightsDeclaredAt: new Date(),
          sourceLanguage: dto.sourceLanguage,
          sourcePatternId: source.id,
          status: 'precheck_pending',
          tagCodes: [...dto.tagCodes].sort(),
          title,
          width: source.width,
        });
        await manager.getRepository(ObjectRegistryEntity).update(
          [{ objectKey: artifactObjectKey }, { objectKey: previewObjectKey }],
          { missing: false, state: 'available' },
        );
        return created;
      });
      return this.ownerView(submission, false);
    } catch (error: unknown) {
      await this.removeSnapshotObjects([artifactObjectKey, previewObjectKey]);
      throw error;
    }
  }

  async listMine(principal: AuthPrincipal) {
    const accountId = this.requireAccount(principal);
    const submissions = await this.dataSource.getRepository(CatalogSubmissionEntity).find({
      order: { createdAt: 'DESC' },
      where: { accountId },
    });
    const appealed = await this.appealedSubmissionIds(submissions.map((item) => item.id));
    return submissions.map((submission) => this.ownerView(submission, appealed.has(submission.id)));
  }

  async getMine(principal: AuthPrincipal, id: string) {
    const accountId = this.requireAccount(principal);
    const submission = await this.dataSource.getRepository(CatalogSubmissionEntity).findOneBy({ id, accountId });
    if (submission === null) throw new NotFoundException('Catalog Submission not found');
    const appeal = await this.dataSource.getRepository(CatalogAppealEntity).findOneBy({ submissionId: id });
    return this.ownerView(submission, appeal !== null);
  }

  async createAppeal(principal: AuthPrincipal, id: string, dto: CreateCatalogAppealDto) {
    const accountId = this.requireAccount(principal);
    const snapshot = await this.dataSource.getRepository(CatalogSubmissionEntity).findOneBy({
      accountId,
      id,
    });
    if (snapshot === null) throw new NotFoundException('Catalog Submission not found');
    if (snapshot.status !== 'rejected') {
      throw new ConflictException('Only an initially rejected submission can be appealed');
    }
    const validation = await this.precheck.revalidateInvariants(snapshot);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CatalogSubmissionEntity);
      const submission = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { accountId, id },
      });
      if (submission === null) throw new NotFoundException('Catalog Submission not found');
      if (submission.status !== 'rejected') throw new ConflictException('Only an initially rejected submission can be appealed');
      const existing = await manager.getRepository(CatalogAppealEntity).findOneBy({ submissionId: id });
      if (existing !== null) throw new ConflictException('This Catalog Submission has already used its appeal');
      const appeal = await manager.getRepository(CatalogAppealEntity).save({
        accountId,
        note: dto.note?.trim() || null,
        submissionId: id,
      });
      submission.metadataErrors = validation.metadataErrors;
      submission.metadataValid = validation.metadataErrors.length === 0;
      submission.status = 'appeal_pending';
      submission.technicalErrors = validation.technicalErrors;
      submission.technicalValid = validation.technicalErrors.length === 0;
      await repository.save(submission);
      return { createdAt: appeal.createdAt.toISOString(), id: appeal.id, submissionId: id };
    });
  }

  async listForReview(status?: string) {
    const allowed = ['review_pending', 'quarantined', 'appeal_pending'];
    const statuses = status === undefined ? allowed : allowed.includes(status) ? [status] : [];
    if (statuses.length === 0) throw new BadRequestException('Unknown Catalog Review status');
    const rows = await this.dataSource.getRepository(CatalogSubmissionEntity)
      .createQueryBuilder('submission')
      .where('submission.status IN (:...statuses)', { statuses })
      .orderBy('submission.createdAt', 'ASC')
      .getMany();
    return rows.map((submission) => this.reviewView(submission));
  }

  async getForReview(id: string) {
    const submission = await this.dataSource.getRepository(CatalogSubmissionEntity).findOneBy({ id });
    if (submission === null) throw new NotFoundException('Catalog Submission not found');
    const [appeal, decisions] = await Promise.all([
      this.dataSource.getRepository(CatalogAppealEntity).findOneBy({ submissionId: id }),
      this.dataSource.getRepository(CatalogReviewDecisionEntity).find({
        order: { createdAt: 'ASC' },
        where: { submissionId: id },
      }),
    ]);
    return {
      ...this.reviewView(submission),
      appeal: appeal === null
        ? null
        : { createdAt: appeal.createdAt.toISOString(), note: appeal.note },
      decisions: decisions.map((decision) => ({
        createdAt: decision.createdAt.toISOString(),
        decision: decision.decision,
        note: decision.note,
        operatorAccountId: decision.operatorAccountId,
        rejectionReason: decision.rejectionReason,
        reviewRound: decision.reviewRound,
      })),
    };
  }

  async getReviewPreview(id: string): Promise<Buffer> {
    const submission = await this.dataSource.getRepository(CatalogSubmissionEntity).findOneBy({ id });
    if (submission === null) throw new NotFoundException('Catalog Submission not found');
    const bytes = await this.storage.get(submission.previewObjectKey);
    if (bytes === null) throw new NotFoundException('Catalog Submission preview not found');
    return bytes;
  }

  async accept(
    operatorAccountId: string,
    id: string,
    note?: string,
    requestId: string | null = null,
  ) {
    const snapshot = await this.dataSource.getRepository(CatalogSubmissionEntity).findOneBy({ id });
    if (snapshot === null) throw new NotFoundException('Catalog Submission not found');
    if (snapshot.status === 'accepted' && snapshot.communityPatternId !== null) {
      return this.reviewView(snapshot);
    }
    this.reviewRound(snapshot.status);
    const validation = await this.precheck.revalidateInvariants(snapshot);
    if (
      validation.metadataErrors.length > 0 ||
      validation.technicalErrors.length > 0
    ) {
      throw new ConflictException('Invalid Catalog Submission cannot be accepted');
    }
    return this.dataSource.transaction(async (manager) => {
      const submissions = manager.getRepository(CatalogSubmissionEntity);
      const submission = await submissions.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id },
      });
      if (submission === null) throw new NotFoundException('Catalog Submission not found');
      if (submission.communityPatternId !== null) return this.reviewView(submission);
      const reviewRound = this.reviewRound(submission.status);
      const profile = await manager.getRepository(CreatorProfileEntity).findOneBy({ id: submission.creatorProfileId });
      if (profile === null) throw new ConflictException('Creator Profile is unavailable');
      const tags = submission.tagCodes.length === 0
        ? []
        : await manager.getRepository(TagEntity).findBy({ code: In(submission.tagCodes) });
      if (tags.length !== submission.tagCodes.length || tags.some((tag) => !tag.active)) {
        throw new ConflictException('Invalid Catalog Submission cannot be accepted');
      }
      const category = await manager.getRepository(CategoryEntity).findOneBy({
        active: true,
        code: submission.categoryCode,
      });
      if (category === null) throw new ConflictException('Invalid Catalog Submission cannot be accepted');
      const before = this.auditView(submission);
      const communityPatternId = randomUUID();
      await manager.getRepository(PatternEntity).save({
        artifactByteLength: submission.artifactByteLength,
        artifactChecksum: submission.artifactChecksum,
        artifactObjectKey: submission.artifactObjectKey,
        artifactSchemaVersion: submission.artifactSchemaVersion,
        categoryCode: submission.categoryCode,
        creatorName: profile.displayName,
        creatorProfileId: profile.id,
        description: submission.description,
        height: submission.height,
        id: communityPatternId,
        ownerAccountId: null,
        paletteSize: submission.paletteSize,
        previewObjectKey: submission.previewObjectKey,
        publishedAt: new Date(),
        sourceLanguage: submission.sourceLanguage,
        status: 'available',
        tags,
        title: submission.title,
        unlockPriceTier: null,
        visibility: 'catalog',
        width: submission.width,
      });
      await manager.getRepository(CatalogReviewDecisionEntity).save({
        decision: 'accepted',
        note: note?.trim() || null,
        operatorAccountId,
        rejectionReason: null,
        reviewRound,
        submissionId: id,
      });
      submission.communityPatternId = communityPatternId;
      submission.metadataErrors = validation.metadataErrors;
      submission.metadataValid = true;
      submission.status = 'accepted';
      submission.technicalErrors = validation.technicalErrors;
      submission.technicalValid = true;
      if (reviewRound === 'initial') submission.initialModeratorId = operatorAccountId;
      await submissions.save(submission);
      await this.recordDecisionAudit(manager, {
        action: 'catalog_submission.accept',
        after: this.auditView(submission),
        before,
        id,
        operatorAccountId,
        requestId,
      });
      return this.reviewView(submission);
    });
  }

  async reject(
    operatorAccountId: string,
    id: string,
    reason: CatalogRejectionReason,
    note?: string,
    requestId: string | null = null,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CatalogSubmissionEntity);
      const submission = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id },
      });
      if (submission === null) throw new NotFoundException('Catalog Submission not found');
      const reviewRound = this.reviewRound(submission.status);
      if ((submission.metadataValid === false || submission.technicalValid === false) && reason !== 'technical_invalidity') {
        throw new ConflictException('Invalid submissions must be rejected as Technical Invalidity');
      }
      const before = this.auditView(submission);
      await manager.getRepository(CatalogReviewDecisionEntity).save({
        decision: 'rejected',
        note: note?.trim() || null,
        operatorAccountId,
        rejectionReason: reason,
        reviewRound,
        submissionId: id,
      });
      submission.rejectionNote = note?.trim() || null;
      submission.rejectionReason = reason;
      submission.status = reviewRound === 'initial' ? 'rejected' : 'appeal_upheld';
      if (reviewRound === 'initial') submission.initialModeratorId = operatorAccountId;
      await repository.save(submission);
      await this.recordDecisionAudit(manager, {
        action: reviewRound === 'initial' ? 'catalog_submission.reject' : 'catalog_submission.appeal.reject',
        after: this.auditView(submission),
        before,
        id,
        operatorAccountId,
        requestId,
      });
      return this.reviewView(submission);
    });
  }

  private reviewRound(status: string): 'initial' | 'appeal' {
    if (status === 'review_pending' || status === 'quarantined') return 'initial';
    if (status === 'appeal_pending') return 'appeal';
    throw new ConflictException('Catalog Submission is not awaiting human review');
  }

  private async stageSnapshotObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.dataSource.getRepository(ObjectRegistryEntity).upsert({
      byteLength: bytes.length,
      checksum: sha256(bytes),
      missing: false,
      objectKey: key,
      state: 'uploading',
    }, ['objectKey']);
    await this.storage.put(key, bytes, contentType);
    await this.dataSource.getRepository(ObjectRegistryEntity).update(
      { objectKey: key },
      { missing: false, state: 'verified' },
    );
  }

  private async removeSnapshotObjects(keys: string[]): Promise<void> {
    await Promise.allSettled(keys.map((key) => this.storage.delete(key)));
    await this.dataSource.getRepository(ObjectRegistryEntity)
      .createQueryBuilder()
      .delete()
      .where('object_key IN (:...keys)', { keys })
      .execute();
  }

  private async appealedSubmissionIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.dataSource.getRepository(CatalogAppealEntity)
      .createQueryBuilder('appeal')
      .select('appeal.submissionId', 'submissionId')
      .where('appeal.submissionId IN (:...ids)', { ids })
      .getRawMany<{ submissionId: string }>();
    return new Set(rows.map((row) => row.submissionId));
  }

  private ownerView(submission: CatalogSubmissionEntity, appealed: boolean) {
    return {
      appealed,
      categoryCode: submission.categoryCode,
      communityPatternId: submission.communityPatternId,
      createdAt: submission.createdAt.toISOString(),
      description: submission.description,
      id: submission.id,
      licenseVersion: submission.licenseVersion,
      metadataErrors: submission.metadataErrors ?? [],
      metadataValid: submission.metadataValid,
      rejectionNote: submission.rejectionNote,
      rejectionReason: submission.rejectionReason,
      sourceLanguage: submission.sourceLanguage,
      sourcePatternId: submission.sourcePatternId,
      status: submission.status,
      tagCodes: submission.tagCodes,
      technicalErrors: submission.technicalErrors ?? [],
      technicalValid: submission.technicalValid,
      title: submission.title,
      updatedAt: submission.updatedAt.toISOString(),
    };
  }

  private reviewView(submission: CatalogSubmissionEntity) {
    return {
      ...this.ownerView(submission, submission.status === 'appeal_pending' || submission.status === 'appeal_upheld'),
      accountId: submission.accountId,
      creatorProfileId: submission.creatorProfileId,
      height: submission.height,
      initialModeratorId: submission.initialModeratorId,
      moderationEvidence: submission.moderationEvidence,
      paletteSize: submission.paletteSize,
      previewUrl: `/v1/admin/catalog-submissions/${submission.id}/preview`,
      rightsDeclared: submission.rightsDeclared,
      rightsDeclaredAt: submission.rightsDeclaredAt.toISOString(),
      similarityEvidence: submission.similarityEvidence,
      width: submission.width,
    };
  }

  private auditView(submission: CatalogSubmissionEntity) {
    return {
      communityPatternId: submission.communityPatternId,
      rejectionNote: submission.rejectionNote,
      rejectionReason: submission.rejectionReason,
      status: submission.status,
    };
  }

  private async recordDecisionAudit(
    manager: import('typeorm').EntityManager,
    input: {
      action: string;
      after: ReturnType<CatalogSubmissionService['auditView']>;
      before: ReturnType<CatalogSubmissionService['auditView']>;
      id: string;
      operatorAccountId: string;
      requestId: string | null;
    },
  ): Promise<void> {
    await manager.getRepository(OperatorAuditLogEntity).save({
      action: input.action,
      after: input.after,
      before: input.before,
      operatorAccountId: input.operatorAccountId,
      outcome: 'success',
      requestId: input.requestId,
      targetId: input.id,
      targetType: 'catalog_submission',
    });
  }

  private requireAccount(principal: AuthPrincipal): string {
    if (principal.type !== PrincipalType.Account) throw new ForbiddenException('Registered Account required');
    return principal.id;
  }
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
