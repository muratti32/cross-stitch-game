import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { StitchingSessionEntity, SessionProgressFlagEntity } from './entities';
import { PatternEntity } from '../catalog/entities';
import { AppConfigService } from '../config/app-config.service';
import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(StitchingSessionEntity)
    private readonly sessionRepo: Repository<StitchingSessionEntity>,
    @InjectRepository(SessionProgressFlagEntity)
    private readonly flagRepo: Repository<SessionProgressFlagEntity>,
    @InjectRepository(PatternEntity)
    private readonly patternRepo: Repository<PatternEntity>,
    private readonly configService: AppConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async verifyPatternAvailability(
    principal: AuthPrincipal,
    patternId: string,
  ): Promise<PatternEntity> {
    const pattern = await this.patternRepo.findOne({ where: { id: patternId } });
    if (!pattern) {
      throw new NotFoundException('Pattern not found');
    }
    if (pattern.status !== 'available') {
      throw new ConflictException('Pattern is not available');
    }
    if (
      pattern.visibility === 'personal' &&
      (principal.type !== PrincipalType.Account ||
        pattern.ownerAccountId !== principal.id)
    ) {
      throw new NotFoundException('Pattern not found');
    }
    // Pattern Unlock enforcement (issue #15) slots in here: a non-null
    // unlockPriceTier will additionally require the identity's Unlock.
    return pattern;
  }

  async prepareSession(principal: AuthPrincipal, patternId: string) {
    const pattern = await this.verifyPatternAvailability(principal, patternId);

    // Idempotent create-or-return using raw postgres INSERT ... ON CONFLICT
    const result = (await this.dataSource.query(
      `INSERT INTO "sessions"."stitching_sessions" ("principal_type", "principal_id", "pattern_id", "status")
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT ("principal_type", "principal_id", "pattern_id") WHERE "status" = 'active'
       DO UPDATE SET "status" = 'active' -- dummy update to return ID
       RETURNING "id"`,
      [principal.type as string, principal.id, patternId],
    )) as unknown as { id: string }[];

    const sessionId = result[0].id;

    // Ensure session progress flag row exists
    await this.dataSource.query(
      `INSERT INTO "sessions"."session_progress_flags" ("session_id", "has_any_progress")
       VALUES ($1, false)
       ON CONFLICT ("session_id") DO NOTHING`,
      [sessionId],
    );

    const exp = Math.floor(Date.now() / 1000) + this.configService.grantTtlSeconds;
    const sig = this.signGrant(patternId, exp);
    const url = `/v1/artifacts/${patternId}?exp=${exp}&sig=${sig}`;
    const expiresAt = new Date(exp * 1000).toISOString();

    return {
      sessionId,
      patternId,
      artifact: {
        checksum: pattern.artifactChecksum.trim(),
        byteLength: pattern.artifactByteLength,
        schemaVersion: pattern.artifactSchemaVersion,
      },
      grant: {
        url,
        expiresAt,
      },
    };
  }

  async refreshGrant(principal: AuthPrincipal, sessionId: string) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.principalId !== principal.id || session.principalType !== (principal.type as string)) {
      throw new ForbiddenException('Forbidden: Owner only');
    }

    if (session.status !== 'active') {
      throw new BadRequestException('Session is not active');
    }

    const pattern = await this.patternRepo.findOne({ where: { id: session.patternId } });
    if (!pattern) {
      throw new NotFoundException('Pattern not found');
    }
    if (
      pattern.visibility === 'personal' &&
      (principal.type !== PrincipalType.Account ||
        pattern.ownerAccountId !== principal.id)
    ) {
      throw new NotFoundException('Pattern not found');
    }

    const exp = Math.floor(Date.now() / 1000) + this.configService.grantTtlSeconds;
    const sig = this.signGrant(session.patternId, exp);
    const url = `/v1/artifacts/${session.patternId}?exp=${exp}&sig=${sig}`;
    const expiresAt = new Date(exp * 1000).toISOString();

    return {
      sessionId,
      patternId: session.patternId,
      artifact: {
        checksum: pattern.artifactChecksum.trim(),
        byteLength: pattern.artifactByteLength,
        schemaVersion: pattern.artifactSchemaVersion,
      },
      grant: {
        url,
        expiresAt,
      },
    };
  }

  async cancelSession(principal: AuthPrincipal, id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const session = await manager.findOne(StitchingSessionEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' }, // SELECT FOR UPDATE
      });

      if (!session) {
        // idempotent 204
        return;
      }

      if (session.principalId !== principal.id || session.principalType !== (principal.type as string)) {
        throw new ForbiddenException('Forbidden: Owner only');
      }

      const flag = await manager.findOne(SessionProgressFlagEntity, {
        where: { sessionId: id },
      });

      if (!flag || !flag.hasAnyProgress) {
        await manager.delete(StitchingSessionEntity, { id });
      }
    });
  }

  // Guarded internal way to set progress flag, exposed for tests.
  // Must also lock the session row to prevent race conditions.
  async setProgressFlagInternal(sessionId: string, hasAnyProgress: boolean): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const session = await manager.findOne(StitchingSessionEntity, {
        where: { id: sessionId },
        lock: { mode: 'pessimistic_write' }, // SELECT FOR UPDATE
      });

      if (!session) {
        throw new NotFoundException('Session not found');
      }

      await manager.save(SessionProgressFlagEntity, {
        sessionId,
        hasAnyProgress,
      });
    });
  }

  signGrant(patternId: string, exp: number): string {
    const secret = this.configService.grantSigningSecret;
    const hmac = createHmac('sha256', secret);
    hmac.update(`${patternId}:${exp}`);
    return hmac.digest('hex');
  }

  verifyGrant(patternId: string, exp: number, sig: string): boolean {
    const nowUnix = Math.floor(Date.now() / 1000);
    if (nowUnix > exp) {
      return false;
    }

    const expected = this.signGrant(patternId, exp);
    const bufferExpected = Buffer.from(expected, 'hex');
    const bufferSig = Buffer.from(sig, 'hex');

    if (bufferExpected.length !== bufferSig.length) {
      return false;
    }

    return timingSafeEqual(bufferExpected, bufferSig);
  }
}
