import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import {
  OBJECT_STORAGE,
  ObjectStorage,
} from '../catalog/storage/object-storage.interface';
import { CreateCreatorProfileDto } from './dto/create-creator-profile.dto';
import { UpdateCreatorProfileDto } from './dto/update-creator-profile.dto';
import {
  CreatorProfileAuditEntity,
  CreatorProfileEntity,
  ReservedUsernameEntity,
} from './entities';
import {
  CheckedAvatar,
  ProfileSafetyService,
  UploadedAvatar,
} from './profile-safety.service';
import { ProfileTextPolicyService } from './profile-text-policy.service';

// Creator Restriction masks the public-facing display name with this value;
// see CreatorProfileService.publicView.
const RESTRICTED_DISPLAY_NAME = 'Restricted Creator';

@Injectable()
export class CreatorProfileService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CreatorProfileEntity)
    private readonly profiles: Repository<CreatorProfileEntity>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly safety: ProfileSafetyService,
    private readonly textPolicy: ProfileTextPolicyService,
  ) {}

  async create(
    principal: AuthPrincipal,
    dto: CreateCreatorProfileDto,
    avatar: UploadedAvatar | undefined,
  ) {
    const accountId = this.accountId(principal);
    const username = this.textPolicy.normalizeUsername(dto.username);
    const displayName = this.textPolicy.normalizeDisplayName(dto.displayName);
    this.requireNormalizedLengths(username, displayName);
    this.safety.checkText(username, displayName);
    const checkedAvatar =
      avatar === undefined ? undefined : await this.safety.checkAvatar(avatar);
    const profileId = randomUUID();
    const storedAvatar = await this.storeAvatar(profileId, checkedAvatar);

    try {
      const profile = await this.dataSource.transaction(async (manager) => {
        const accounts = await manager.query<readonly { status: string }[]>(
          'SELECT status FROM auth.registered_accounts WHERE id = $1 FOR SHARE',
          [accountId],
        );
        if (accounts[0]?.status !== 'active') {
          throw new ForbiddenException('Active Registered Account required');
        }
        const reserved = await manager
          .getRepository(ReservedUsernameEntity)
          .exist({ where: { username } });
        if (reserved) {
          throw new ConflictException('Username is unavailable');
        }

        const created = await manager.getRepository(CreatorProfileEntity).save({
          accountId,
          avatarChecksum: storedAvatar?.checksum ?? null,
          avatarContentType: storedAvatar?.contentType ?? null,
          avatarObjectKey: storedAvatar?.objectKey ?? null,
          displayName,
          id: profileId,
          username,
          version: 1,
        });
        await this.appendAudit(manager, created, accountId, 'profile_created');
        return created;
      });
      return this.view(profile);
    } catch (error: unknown) {
      await this.removeUploadedAvatar(storedAvatar?.objectKey);
      this.rethrowConstraint(error);
      throw error;
    }
  }

  async update(
    principal: AuthPrincipal,
    dto: UpdateCreatorProfileDto,
    avatar: UploadedAvatar | undefined,
  ) {
    const accountId = this.accountId(principal);
    if (avatar !== undefined && dto.removeAvatar === true) {
      throw new BadRequestException('Avatar upload and removal cannot be requested together');
    }
    if (avatar === undefined && dto.displayName === undefined && dto.removeAvatar !== true) {
      throw new BadRequestException('At least one profile change is required');
    }

    const existing = await this.profiles.findOneBy({ accountId });
    if (existing === null) throw new NotFoundException('Creator Profile not found');
    if (existing.restrictedAt !== null) {
      throw new ForbiddenException('Creator Profile is restricted');
    }

    const displayName =
      dto.displayName === undefined
        ? undefined
        : this.textPolicy.normalizeDisplayName(dto.displayName);
    if (displayName !== undefined) {
      this.requireNormalizedLengths(existing.username, displayName);
      this.safety.checkText(undefined, displayName);
    }
    const checkedAvatar =
      avatar === undefined ? undefined : await this.safety.checkAvatar(avatar);
    const storedAvatar = await this.storeAvatar(existing.id, checkedAvatar);

    try {
      const profile = await this.dataSource.transaction(async (manager) => {
        const accounts = await manager.query<readonly { status: string }[]>(
          'SELECT status FROM auth.registered_accounts WHERE id = $1 FOR SHARE',
          [accountId],
        );
        if (accounts[0]?.status !== 'active') {
          throw new ForbiddenException('Active Registered Account required');
        }
        const current = await manager.getRepository(CreatorProfileEntity).findOne({
          lock: { mode: 'pessimistic_write' },
          where: { accountId },
        });
        if (current === null) throw new NotFoundException('Creator Profile not found');
        if (current.restrictedAt !== null) {
          throw new ForbiddenException('Creator Profile is restricted');
        }

        const nextDisplayName = displayName ?? current.displayName;
        const nextAvatar =
          storedAvatar !== undefined
            ? storedAvatar
            : dto.removeAvatar === true
              ? null
              : {
                  checksum: current.avatarChecksum,
                  contentType: current.avatarContentType,
                  objectKey: current.avatarObjectKey,
                };
        if (
          storedAvatar === undefined &&
          nextDisplayName === current.displayName &&
          (dto.removeAvatar !== true || current.avatarObjectKey === null)
        ) {
          return current;
        }

        current.displayName = nextDisplayName;
        current.avatarChecksum = nextAvatar?.checksum ?? null;
        current.avatarContentType = nextAvatar?.contentType ?? null;
        current.avatarObjectKey = nextAvatar?.objectKey ?? null;
        current.version += 1;
        const updated = await manager.getRepository(CreatorProfileEntity).save(current);
        await this.appendAudit(manager, updated, accountId, 'profile_updated');
        return updated;
      });
      return this.view(profile);
    } catch (error: unknown) {
      await this.removeUploadedAvatar(storedAvatar?.objectKey);
      throw error;
    }
  }

  async getMine(principal: AuthPrincipal) {
    const profile = await this.profiles.findOneBy({
      accountId: this.accountId(principal),
    });
    if (profile === null) throw new NotFoundException('Creator Profile not found');
    return this.view(profile);
  }

  async getPublic(id: string) {
    const profile = await this.profiles.findOneBy({ id });
    if (profile === null || profile.closureHoldAt !== null) {
      throw new NotFoundException('Creator Profile not found');
    }
    return this.publicView(profile);
  }

  async getAvatar(id: string): Promise<{ bytes: Buffer; contentType: string }> {
    const profile = await this.profiles.findOneBy({ id });
    if (
      profile === null ||
      profile.closureHoldAt !== null ||
      profile.restrictedAt !== null ||
      profile.avatarObjectKey === null ||
      profile.avatarContentType === null
    ) {
      throw new NotFoundException('Avatar not found');
    }
    const bytes = await this.storage.get(profile.avatarObjectKey);
    if (bytes === null) throw new NotFoundException('Avatar not found');
    return { bytes, contentType: profile.avatarContentType };
  }

  private async appendAudit(
    manager: EntityManager,
    profile: CreatorProfileEntity,
    actorId: string,
    reason: string,
  ): Promise<void> {
    await manager.getRepository(CreatorProfileAuditEntity).save({
      actorId,
      actorType: 'account',
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

  private accountId(principal: AuthPrincipal): string {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('Registered Account required');
    }
    return principal.id;
  }

  private async removeUploadedAvatar(objectKey: string | undefined): Promise<void> {
    if (objectKey === undefined) return;
    try {
      await this.storage.delete(objectKey);
    } catch {
      // The database remains authoritative. Storage reconciliation can remove
      // an upload that could not be cleaned up after a failed publication.
    }
  }

  private requireNormalizedLengths(username: string, displayName: string): void {
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      throw new BadRequestException('Username format is invalid');
    }
    if (displayName.length < 1 || displayName.length > 50) {
      throw new BadRequestException('Display name must be between 1 and 50 characters');
    }
  }

  private rethrowConstraint(error: unknown): void {
    if (!(error instanceof QueryFailedError)) return;
    const constraint = (error.driverError as { constraint?: unknown }).constraint;
    if (constraint === 'UQ_creator_profiles_username') {
      throw new ConflictException('Username is unavailable');
    }
    if (constraint === 'UQ_creator_profiles_account') {
      throw new ConflictException('Creator Profile already exists');
    }
  }

  private async storeAvatar(
    profileId: string,
    avatar: CheckedAvatar | undefined,
  ): Promise<
    | { checksum: string; contentType: string; objectKey: string }
    | undefined
  > {
    if (avatar === undefined) return undefined;
    const objectKey = `creator-profiles/${profileId}/avatars/${randomUUID()}.${avatar.extension}`;
    await this.storage.put(objectKey, avatar.bytes, avatar.contentType);
    return {
      checksum: createHash('sha256').update(avatar.bytes).digest('hex'),
      contentType: avatar.contentType,
      objectKey,
    };
  }

  private view(profile: CreatorProfileEntity) {
    return {
      avatarUrl:
        profile.avatarObjectKey === null
          ? null
          : `/v1/creator-profiles/${profile.id}/avatar?v=${profile.version}`,
      createdAt: profile.createdAt.toISOString(),
      displayName: profile.displayName,
      id: profile.id,
      restricted: profile.restrictedAt !== null,
      closureHold: profile.closureHoldAt !== null,
      updatedAt: profile.updatedAt.toISOString(),
      username: profile.username,
    };
  }

  private publicView(profile: CreatorProfileEntity) {
    const base = this.view(profile);
    const rest = {
      avatarUrl: base.avatarUrl,
      createdAt: base.createdAt,
      displayName: base.displayName,
      id: base.id,
      restricted: base.restricted,
      updatedAt: base.updatedAt,
      username: base.username,
    };
    if (profile.restrictedAt === null) return rest;
    return { ...rest, avatarUrl: null, displayName: RESTRICTED_DISPLAY_NAME };
  }
}
