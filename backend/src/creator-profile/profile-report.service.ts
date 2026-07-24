import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import {
  OBJECT_STORAGE,
  ObjectStorage,
} from '../catalog/storage/object-storage.interface';
import { CreateProfileAppealDto } from './dto/create-profile-appeal.dto';
import { CreateProfileReportDto } from './dto/create-profile-report.dto';
import {
  CreatorProfileAppealEntity,
  CreatorProfileAuditEntity,
  CreatorProfileAuditEventEntity,
  CreatorProfileEntity,
  ProfileInvestigationEntity,
  ProfileReportEntity,
  ReservedUsernameEntity,
} from './entities';
import { ProfileTextPolicyService } from './profile-text-policy.service';

// After a case is closed, a repeat report on the same profile is rate-limited:
// a new case only opens on a newly published profile state (version bump) or
// once this cooldown elapses, which stands in for "materially new evidence".
const REPORT_REOPEN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Profile Remediation replaces the display name with this safe default; the
// player can submit a new compliant display name afterward via Profile
// Safety Check, so this is not meant to persist as a real identity.
const REMEDIATED_DISPLAY_NAME = 'Creator';

const USERNAME_RESET_MAX_ATTEMPTS = 8;

function generateSystemUsername(): string {
  return `creator_${randomBytes(4).toString('hex')}`;
}

@Injectable()
export class ProfileReportService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly textPolicy: ProfileTextPolicyService,
  ) {}

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

  async close(
    operatorId: string,
    investigationId: string,
    reason: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const investigation = await this.lockOpenInvestigation(manager, investigationId);
      investigation.status = 'closed';
      investigation.closedAt = new Date();
      investigation.closedBy = operatorId;
      investigation.closeOutcome = 'no_action';
      const saved = await manager
        .getRepository(ProfileInvestigationEntity)
        .save(investigation);
      await this.appendEvent(manager, {
        actorId: operatorId,
        actorType: 'operator',
        eventType: 'investigation_closed',
        investigationId: saved.id,
        profileId: saved.profileId,
        reason,
        reportId: null,
      });
      return this.investigationView(saved);
    });
  }

  async remediate(
    operatorId: string,
    investigationId: string,
    reason: string,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      const investigation = await this.lockOpenInvestigation(manager, investigationId);
      const profiles = manager.getRepository(CreatorProfileEntity);
      const profile = await profiles.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: investigation.profileId },
      });
      if (profile === null) throw new NotFoundException('Creator Profile not found');

      const removedAvatarObjectKey = profile.avatarObjectKey;
      profile.displayName = REMEDIATED_DISPLAY_NAME;
      profile.avatarObjectKey = null;
      profile.avatarContentType = null;
      profile.avatarChecksum = null;
      profile.version += 1;
      const savedProfile = await profiles.save(profile);

      await this.appendProfileSnapshot(manager, savedProfile, operatorId, reason);
      await this.appendEvent(manager, {
        actorId: operatorId,
        actorType: 'operator',
        eventType: 'profile_remediated',
        investigationId: investigation.id,
        profileId: savedProfile.id,
        reason,
        reportId: null,
      });

      investigation.status = 'closed';
      investigation.closedAt = new Date();
      investigation.closedBy = operatorId;
      investigation.closeOutcome = 'remediated';
      const savedInvestigation = await manager
        .getRepository(ProfileInvestigationEntity)
        .save(investigation);
      await this.appendEvent(manager, {
        actorId: operatorId,
        actorType: 'operator',
        eventType: 'investigation_closed',
        investigationId: savedInvestigation.id,
        profileId: savedProfile.id,
        reason,
        reportId: null,
      });

      return { removedAvatarObjectKey, view: this.investigationView(savedInvestigation) };
    });

    if (result.removedAvatarObjectKey !== null) {
      await this.removeStoredAvatar(result.removedAvatarObjectKey);
    }
    return result.view;
  }

  async resetUsername(
    operatorId: string,
    investigationId: string,
    reason: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const investigation = await this.lockOpenInvestigation(manager, investigationId);
      const profiles = manager.getRepository(CreatorProfileEntity);
      const profile = await profiles.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: investigation.profileId },
      });
      if (profile === null) throw new NotFoundException('Creator Profile not found');

      const { newUsername } = await this.performUsernameReset(manager, profile);

      await this.appendProfileSnapshot(manager, profile, operatorId, reason);
      await this.appendEvent(manager, {
        actorId: operatorId,
        actorType: 'operator',
        eventType: 'username_reset',
        investigationId: investigation.id,
        profileId: profile.id,
        reason,
        reportId: null,
      });

      investigation.status = 'closed';
      investigation.closedAt = new Date();
      investigation.closedBy = operatorId;
      investigation.closeOutcome = 'username_reset';
      const savedInvestigation = await manager
        .getRepository(ProfileInvestigationEntity)
        .save(investigation);
      await this.appendEvent(manager, {
        actorId: operatorId,
        actorType: 'operator',
        eventType: 'investigation_closed',
        investigationId: savedInvestigation.id,
        profileId: profile.id,
        reason,
        reportId: null,
      });

      return { ...this.investigationView(savedInvestigation), newUsername };
    });
  }

  async fileAppeal(principal: AuthPrincipal, dto: CreateProfileAppealDto) {
    const accountId = this.accountId(principal);
    const note = dto.note?.trim() ? dto.note.trim() : null;

    return this.dataSource.transaction(async (manager) => {
      const profiles = manager.getRepository(CreatorProfileEntity);
      const profile = await profiles.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { accountId },
      });
      if (profile === null) throw new NotFoundException('Creator Profile not found');
      if (profile.restrictedAt === null) {
        throw new ConflictException('Creator Profile is not restricted');
      }

      const restricting = await manager.getRepository(ProfileInvestigationEntity).findOne({
        order: { closedAt: 'DESC' },
        where: { closeOutcome: 'restricted', profileId: profile.id, status: 'closed' },
      });
      if (restricting === null) {
        throw new ConflictException('No Creator Restriction decision found for this Creator Profile');
      }

      const appeals = manager.getRepository(CreatorProfileAppealEntity);
      const existing = await appeals.findOneBy({ investigationId: restricting.id });
      if (existing !== null) {
        throw new ConflictException('This Creator Restriction has already used its appeal');
      }

      const assignedOperatorId = await this.pickAssignedOperator(manager, restricting.closedBy);

      const appeal = await appeals.save(
        appeals.create({
          accountId,
          assignedOperatorId,
          investigationId: restricting.id,
          note,
          profileId: profile.id,
          restrictingOperatorId: restricting.closedBy,
          status: 'open',
        }),
      );

      await this.appendEvent(manager, {
        actorId: accountId,
        actorType: 'account',
        eventType: 'appeal_filed',
        investigationId: restricting.id,
        profileId: profile.id,
        reason: null,
        reportId: null,
      });

      return this.appealView(appeal);
    });
  }

  async acceptAppeal(operatorId: string, appealId: string, reason: string) {
    return this.dataSource.transaction(async (manager) => {
      const appeal = await this.lockOpenAppeal(manager, appealId);
      const profiles = manager.getRepository(CreatorProfileEntity);
      const profile = await profiles.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: appeal.profileId },
      });
      if (profile === null) throw new NotFoundException('Creator Profile not found');

      // If no safe historic username survives (the stored value itself would
      // fail today's policy), Username Reset supplies one before restoring
      // visibility; otherwise the username the account already had is kept.
      let newUsername: string | null = null;
      if (this.textPolicy.rejectionReason('username', profile.username) !== null) {
        const reset = await this.performUsernameReset(manager, profile);
        newUsername = reset.newUsername;
        await this.appendProfileSnapshot(manager, profile, operatorId, reason);
        await this.appendEvent(manager, {
          actorId: operatorId,
          actorType: 'operator',
          eventType: 'username_reset',
          investigationId: appeal.investigationId,
          profileId: profile.id,
          reason,
          reportId: null,
        });
      }

      profile.restrictedAt = null;
      await profiles.save(profile);

      await this.appendEvent(manager, {
        actorId: operatorId,
        actorType: 'operator',
        eventType: 'appeal_accepted',
        investigationId: appeal.investigationId,
        profileId: profile.id,
        reason,
        reportId: null,
      });

      appeal.status = 'accepted';
      appeal.decidedBy = operatorId;
      appeal.decidedAt = new Date();
      appeal.reason = reason;
      const savedAppeal = await manager.getRepository(CreatorProfileAppealEntity).save(appeal);

      return { ...this.appealView(savedAppeal), newUsername };
    });
  }

  async upholdAppeal(operatorId: string, appealId: string, reason: string) {
    return this.dataSource.transaction(async (manager) => {
      const appeal = await this.lockOpenAppeal(manager, appealId);
      appeal.status = 'upheld';
      appeal.decidedBy = operatorId;
      appeal.decidedAt = new Date();
      appeal.reason = reason;
      const saved = await manager.getRepository(CreatorProfileAppealEntity).save(appeal);

      await this.appendEvent(manager, {
        actorId: operatorId,
        actorType: 'operator',
        eventType: 'appeal_upheld',
        investigationId: appeal.investigationId,
        profileId: appeal.profileId,
        reason,
        reportId: null,
      });

      return this.appealView(saved);
    });
  }

  async listAppeals(status = 'open') {
    if (status !== 'open' && status !== 'accepted' && status !== 'upheld') {
      throw new BadRequestException('Unknown Creator Restriction Appeal status');
    }
    const appeals = await this.dataSource
      .getRepository(CreatorProfileAppealEntity)
      .find({ order: { createdAt: 'ASC' }, where: { status } });
    return appeals.map((appeal) => this.appealView(appeal));
  }

  async getAppeal(id: string) {
    const appeal = await this.dataSource
      .getRepository(CreatorProfileAppealEntity)
      .findOneBy({ id });
    if (appeal === null) {
      throw new NotFoundException('Creator Restriction Appeal not found');
    }
    return this.appealView(appeal);
  }

  async restrict(
    operatorId: string,
    investigationId: string,
    reason: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const investigation = await this.lockOpenInvestigation(manager, investigationId);
      const profiles = manager.getRepository(CreatorProfileEntity);
      const profile = await profiles.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: investigation.profileId },
      });
      if (profile === null) throw new NotFoundException('Creator Profile not found');

      // Non-destructive: the stored identity is left as-is so a future
      // appeal can restore it. Only the read paths mask it while restricted.
      profile.restrictedAt = new Date();
      const savedProfile = await profiles.save(profile);

      await this.appendEvent(manager, {
        actorId: operatorId,
        actorType: 'operator',
        eventType: 'creator_restricted',
        investigationId: investigation.id,
        profileId: savedProfile.id,
        reason,
        reportId: null,
      });

      investigation.status = 'closed';
      investigation.closedAt = new Date();
      investigation.closedBy = operatorId;
      investigation.closeOutcome = 'restricted';
      const savedInvestigation = await manager
        .getRepository(ProfileInvestigationEntity)
        .save(investigation);
      await this.appendEvent(manager, {
        actorId: operatorId,
        actorType: 'operator',
        eventType: 'investigation_closed',
        investigationId: savedInvestigation.id,
        profileId: savedProfile.id,
        reason,
        reportId: null,
      });

      return this.investigationView(savedInvestigation);
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

  private async lockOpenInvestigation(
    manager: EntityManager,
    id: string,
  ): Promise<ProfileInvestigationEntity> {
    const investigation = await manager
      .getRepository(ProfileInvestigationEntity)
      .findOne({ lock: { mode: 'pessimistic_write' }, where: { id } });
    if (investigation === null) {
      throw new NotFoundException('Profile Investigation not found');
    }
    if (investigation.status !== 'open') {
      throw new ConflictException('Profile Investigation is already closed');
    }
    return investigation;
  }

  private async lockOpenAppeal(
    manager: EntityManager,
    id: string,
  ): Promise<CreatorProfileAppealEntity> {
    const appeal = await manager
      .getRepository(CreatorProfileAppealEntity)
      .findOne({ lock: { mode: 'pessimistic_write' }, where: { id } });
    if (appeal === null) {
      throw new NotFoundException('Creator Restriction Appeal not found');
    }
    if (appeal.status !== 'open') {
      throw new ConflictException('Creator Restriction Appeal is already decided');
    }
    return appeal;
  }

  // Shared by Moderator Username Reset and an accepted Creator Restriction
  // Appeal that finds no safe historic username. Mutates `profile` in place
  // (username + version) so the caller's own snapshot/audit code sees the
  // post-reset values.
  private async performUsernameReset(
    manager: EntityManager,
    profile: CreatorProfileEntity,
  ): Promise<{ newUsername: string; releasedUsername: string }> {
    const profiles = manager.getRepository(CreatorProfileEntity);
    const reserved = manager.getRepository(ReservedUsernameEntity);
    const releasedUsername = profile.username;
    let nextUsername: string | null = null;
    for (let attempt = 0; attempt < USERNAME_RESET_MAX_ATTEMPTS; attempt += 1) {
      const candidate = generateSystemUsername();
      const taken =
        (await profiles.exist({ where: { username: candidate } })) ||
        (await reserved.exist({ where: { username: candidate } }));
      if (!taken) {
        nextUsername = candidate;
        break;
      }
    }
    if (nextUsername === null) {
      throw new ConflictException('Could not allocate a safe username');
    }

    // Usernames are permanent for every other write path (enforced by a
    // database trigger); this is the sole exceptional path, opted into for
    // this transaction only via a local session setting.
    await manager.query("SELECT set_config('app.moderator_username_reset', 'on', true)");
    profile.username = nextUsername;
    profile.version += 1;
    await profiles.save(profile);
    await reserved.save(reserved.create({ profileId: profile.id, username: releasedUsername }));
    return { newUsername: nextUsername, releasedUsername };
  }

  private async appendProfileSnapshot(
    manager: EntityManager,
    profile: CreatorProfileEntity,
    operatorId: string,
    reason: string,
  ): Promise<void> {
    await manager.getRepository(CreatorProfileAuditEntity).save({
      actorId: operatorId,
      actorType: 'operator',
      avatarChecksum: profile.avatarChecksum,
      avatarContentType: profile.avatarContentType,
      avatarObjectKey: profile.avatarObjectKey,
      displayName: profile.displayName,
      profileId: profile.id,
      reason,
      username: profile.username,
      version: profile.version,
    });
  }

  // Prefers an operator other than the one who imposed the restriction, so
  // the appeal is reviewed by a different moderator when operationally
  // possible; falls back to null (any moderator, including the original) if
  // no other active operator exists.
  private async pickAssignedOperator(
    manager: EntityManager,
    excludeOperatorId: string | null,
  ): Promise<string | null> {
    const rows = await manager.query<readonly { id: string }[]>(
      `SELECT id FROM admin.operator_accounts
       WHERE disabled = false AND ($1::uuid IS NULL OR id != $1)
       ORDER BY created_at ASC
       LIMIT 1`,
      [excludeOperatorId],
    );
    return rows[0]?.id ?? null;
  }

  private appealView(appeal: CreatorProfileAppealEntity) {
    return {
      assignedOperatorId: appeal.assignedOperatorId,
      createdAt: appeal.createdAt.toISOString(),
      decidedAt: appeal.decidedAt?.toISOString() ?? null,
      id: appeal.id,
      investigationId: appeal.investigationId,
      profileId: appeal.profileId,
      status: appeal.status,
    };
  }

  private async removeStoredAvatar(objectKey: string): Promise<void> {
    try {
      await this.storage.delete(objectKey);
    } catch {
      // The database remains authoritative. Storage reconciliation can clean
      // up an object that could not be deleted here.
    }
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
