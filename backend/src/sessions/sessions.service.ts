import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { StitchingSessionEntity, SessionProgressFlagEntity } from './entities';
import { PatternEntity } from '../catalog/entities';
import { AppConfigService } from '../config/app-config.service';
import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { CoinLedgerRepository } from '../economy/coin-ledger.repository';
import { unlockPrice } from '../economy/economy.constants';

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
    private readonly coinLedger: CoinLedgerRepository,
  ) {}

  async verifyPatternAvailability(
    principal: AuthPrincipal,
    patternId: string,
  ): Promise<PatternEntity> {
    const pattern = await this.patternRepo.findOne({ where: { id: patternId } });
    if (!pattern) {
      throw new NotFoundException('Pattern not found');
    }
    this.assertPatternVisible(principal, pattern);
    if (pattern.status !== 'available') {
      throw new ConflictException('Pattern is not available');
    }
    await this.assertPatternUnlocked(this.dataSource.manager, principal, pattern);
    return pattern;
  }

  async prepareSession(principal: AuthPrincipal, patternId: string) {
    return this.dataSource.transaction(async (manager) => {
      // Serialize Session Preparation with owner withdrawal so a request either
      // creates the session before withdrawal or observes the withdrawn state.
      const pattern = await manager.getRepository(PatternEntity).findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: patternId },
      });
      if (pattern === null) throw new NotFoundException('Pattern not found');
      this.assertPatternVisible(principal, pattern);

      const sessions = manager.getRepository(StitchingSessionEntity);
      const existing = await sessions.findOneBy({
        patternId,
        principalId: principal.id,
        principalType: principal.type as string,
        status: 'active',
      });
      if (pattern.status !== 'available') {
        if (
          pattern.status !== 'withdrawn' ||
          pattern.visibility !== 'catalog' ||
          existing === null
        ) {
          throw new ConflictException('Pattern is not available');
        }
        return this.preparationResponse(existing.id, pattern);
      }

      await this.assertPatternUnlocked(manager, principal, pattern);
      const result = (await manager.query(
        `INSERT INTO "sessions"."stitching_sessions" ("principal_type", "principal_id", "pattern_id", "status")
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT ("principal_type", "principal_id", "pattern_id") WHERE "status" = 'active'
         DO UPDATE SET "status" = 'active'
         RETURNING "id"`,
        [principal.type as string, principal.id, patternId],
      )) as unknown as { id: string }[];
      const sessionId = result[0].id;

      await manager.query(
        `INSERT INTO "sessions"."session_progress_flags" ("session_id", "has_any_progress")
         VALUES ($1, false)
         ON CONFLICT ("session_id") DO NOTHING`,
        [sessionId],
      );
      return this.preparationResponse(sessionId, pattern);
    });
  }

  async refreshGrant(principal: AuthPrincipal, sessionId: string) {
    return this.dataSource.transaction(async (manager) => {
      const session = await manager.getRepository(StitchingSessionEntity).findOne({
        where: { id: sessionId },
      });
      if (!session) throw new NotFoundException('Session not found');
      if (
        session.principalId !== principal.id ||
        session.principalType !== (principal.type as string)
      ) {
        throw new ForbiddenException('Forbidden: Owner only');
      }
      if (session.status !== 'active') {
        throw new BadRequestException('Session is not active');
      }

      const pattern = await manager.getRepository(PatternEntity).findOne({
        lock: { mode: 'pessimistic_read' },
        where: { id: session.patternId },
      });
      if (pattern === null) throw new NotFoundException('Pattern not found');
      this.assertPatternVisible(principal, pattern);
      if (
        pattern.status === 'removed' ||
        (pattern.status === 'withdrawn' && pattern.visibility !== 'catalog')
      ) {
        throw new ConflictException('Pattern is not available');
      }
      return this.preparationResponse(sessionId, pattern);
    });
  }

  private assertPatternVisible(principal: AuthPrincipal, pattern: PatternEntity): void {
    if (
      pattern.visibility === 'personal' &&
      (principal.type !== PrincipalType.Account || pattern.ownerAccountId !== principal.id)
    ) {
      throw new NotFoundException('Pattern not found');
    }
  }

  private async assertPatternUnlocked(
    manager: EntityManager,
    principal: AuthPrincipal,
    pattern: PatternEntity,
  ): Promise<void> {
    if (pattern.unlockPriceTier === null) return;
    const ledgerPrincipal = {
      id: principal.id,
      type: principal.type === PrincipalType.Account ? ('account' as const) : ('guest' as const),
    };
    const owned = await this.coinLedger.isPatternUnlocked(
      manager,
      ledgerPrincipal,
      pattern.id,
    );
    if (!owned) {
      throw new ForbiddenException({
        code: 'unlock_required',
        patternId: pattern.id,
        price: unlockPrice(pattern.unlockPriceTier),
      });
    }
  }

  private preparationResponse(sessionId: string, pattern: PatternEntity) {
    const exp = Math.floor(Date.now() / 1000) + this.configService.grantTtlSeconds;
    const sig = this.signGrant(pattern.id, exp);
    return {
      artifact: {
        byteLength: pattern.artifactByteLength,
        checksum: pattern.artifactChecksum.trim(),
        schemaVersion: pattern.artifactSchemaVersion,
      },
      grant: {
        expiresAt: new Date(exp * 1000).toISOString(),
        url: `/v1/artifacts/${pattern.id}?exp=${exp}&sig=${sig}`,
      },
      patternId: pattern.id,
      sessionId,
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
