import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { CreateProfileReportDto } from './dto/create-profile-report.dto';
import {
  CreatorProfileAuditEventEntity,
  ProfileInvestigationEntity,
  ProfileReportEntity,
} from './entities';

// After a case is closed, a repeat report on the same profile is rate-limited:
// a new case only opens on a newly published profile state (version bump) or
// once this cooldown elapses, which stands in for "materially new evidence".
const REPORT_REOPEN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ProfileReportService {
  constructor(private readonly dataSource: DataSource) {}

  async report(
    principal: AuthPrincipal,
    profileId: string,
    dto: CreateProfileReportDto,
  ) {
    const reporterAccountId = this.accountId(principal);
    const note = dto.note?.trim() ? dto.note.trim() : null;

    return this.dataSource.transaction(async (manager) => {
      // Serialize per-profile so concurrent reporters cannot each open a case.
      const locked = await manager.query<
        readonly { account_id: string; version: number }[]
      >(
        'SELECT account_id, version FROM moderation.creator_profiles WHERE id = $1 FOR UPDATE',
        [profileId],
      );
      const profile = locked[0];
      if (profile === undefined) {
        throw new NotFoundException('Creator Profile not found');
      }
      if (profile.account_id === reporterAccountId) {
        throw new ForbiddenException('You cannot report your own Public Creator Profile');
      }

      const investigations = manager.getRepository(ProfileInvestigationEntity);
      const reports = manager.getRepository(ProfileReportEntity);

      const open = await investigations.findOne({
        where: { profileId, status: 'open' },
      });

      if (open !== null) {
        const existing = await reports.findOne({
          where: { investigationId: open.id, reporterAccountId },
        });
        if (existing !== null) {
          return this.view(open, existing, true);
        }
        const report = await this.insertReport(
          manager,
          open,
          profileId,
          reporterAccountId,
          dto,
          note,
        );
        open.reportCount += 1;
        await investigations.save(open);
        return this.view(open, report, false);
      }

      const latestClosed = await investigations.findOne({
        order: { closedAt: 'DESC' },
        where: { profileId, status: 'closed' },
      });
      if (latestClosed !== null && !this.canReopen(latestClosed, profile.version)) {
        throw new HttpException(
          'This Public Creator Profile was recently reviewed. Report again only if it changes or you have new evidence.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const investigation = await investigations.save(
        investigations.create({
          profileId,
          profileVersionAtOpen: profile.version,
          reportCount: 0,
          status: 'open',
        }),
      );
      await this.appendEvent(manager, {
        actorId: null,
        actorType: 'system',
        eventType: 'investigation_opened',
        investigationId: investigation.id,
        profileId,
        reason: 'profile_reported',
        reportId: null,
      });
      const report = await this.insertReport(
        manager,
        investigation,
        profileId,
        reporterAccountId,
        dto,
        note,
      );
      investigation.reportCount = 1;
      await investigations.save(investigation);
      return this.view(investigation, report, false);
    });
  }

  async listInvestigations(status = 'open') {
    if (status !== 'open' && status !== 'closed') {
      throw new BadRequestException('Unknown Profile Investigation status');
    }
    const investigations = await this.dataSource
      .getRepository(ProfileInvestigationEntity)
      .find({ order: { openedAt: 'ASC' }, where: { status } });
    return investigations.map((investigation) =>
      this.investigationView(investigation),
    );
  }

  async getInvestigation(id: string) {
    const investigation = await this.dataSource
      .getRepository(ProfileInvestigationEntity)
      .findOneBy({ id });
    if (investigation === null) {
      throw new NotFoundException('Profile Investigation not found');
    }
    const reports = await this.dataSource
      .getRepository(ProfileReportEntity)
      .find({ order: { createdAt: 'ASC' }, where: { investigationId: id } });
    return {
      ...this.investigationView(investigation),
      reports: reports.map((report) => ({
        createdAt: report.createdAt.toISOString(),
        id: report.id,
        note: report.note,
        reasonCode: report.reasonCode,
        reporterAccountId: report.reporterAccountId,
      })),
    };
  }

  private canReopen(
    latestClosed: ProfileInvestigationEntity,
    currentVersion: number,
  ): boolean {
    if (currentVersion > latestClosed.profileVersionAtOpen) return true;
    if (latestClosed.closedAt === null) return true;
    return Date.now() - latestClosed.closedAt.getTime() >= REPORT_REOPEN_COOLDOWN_MS;
  }

  private async insertReport(
    manager: EntityManager,
    investigation: ProfileInvestigationEntity,
    profileId: string,
    reporterAccountId: string,
    dto: CreateProfileReportDto,
    note: string | null,
  ): Promise<ProfileReportEntity> {
    const reports = manager.getRepository(ProfileReportEntity);
    const report = await reports.save(
      reports.create({
        investigationId: investigation.id,
        note,
        profileId,
        reasonCode: dto.reasonCode,
        reporterAccountId,
      }),
    );
    await this.appendEvent(manager, {
      actorId: reporterAccountId,
      actorType: 'account',
      eventType: 'report_submitted',
      investigationId: investigation.id,
      profileId,
      reason: dto.reasonCode,
      reportId: report.id,
    });
    return report;
  }

  private async appendEvent(
    manager: EntityManager,
    event: {
      actorId: string | null;
      actorType: CreatorProfileAuditEventEntity['actorType'];
      eventType: string;
      investigationId: string | null;
      profileId: string;
      reason: string | null;
      reportId: string | null;
    },
  ): Promise<void> {
    await manager.getRepository(CreatorProfileAuditEventEntity).save(event);
  }

  private view(
    investigation: ProfileInvestigationEntity,
    report: ProfileReportEntity,
    deduped: boolean,
  ) {
    return {
      deduped,
      investigationId: investigation.id,
      report: {
        createdAt: report.createdAt.toISOString(),
        id: report.id,
        reasonCode: report.reasonCode,
      },
      status: investigation.status,
    };
  }

  private investigationView(investigation: ProfileInvestigationEntity) {
    return {
      closedAt: investigation.closedAt?.toISOString() ?? null,
      id: investigation.id,
      openedAt: investigation.openedAt.toISOString(),
      profileId: investigation.profileId,
      reportCount: investigation.reportCount,
      status: investigation.status,
    };
  }

  private accountId(principal: AuthPrincipal): string {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('Registered Account required');
    }
    return principal.id;
  }
}
