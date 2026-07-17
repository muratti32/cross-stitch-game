import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';
import {
  ADMIN_PRINCIPAL_TYPE,
  OPERATOR_LOGIN_CHALLENGE_TTL_SECONDS,
} from './admin.constants';
import {
  OperatorAccountEntity,
  OperatorLoginChallengeEntity,
  OperatorRecoveryCodeEntity,
} from './entities';
import { OperatorHashingService } from './operator-hashing.service';
import { OperatorAuthRateLimiterService } from './operator-auth-rate-limiter.service';
import { OperatorRefreshTokensRepository } from './operator-refresh-tokens.repository';
import { OperatorSecurityEventsService } from './operator-security-events.service';
import { OperatorTotpService } from './operator-totp.service';
import { TotpSecretCipherService } from './totp-secret-cipher.service';
import {
  OperatorAccessTokenPayload,
  OperatorTokenPair,
} from './operator-auth.types';

export interface OperatorMfaRequiredResponse {
  status: 'mfa_required';
  challenge: string;
  expiresAt: string;
}

export interface OperatorSessionResponse extends OperatorTokenPair {
  operator: { id: string; email: string; role: string };
}

@Injectable()
export class OperatorAuthService {
  constructor(
    private readonly config: AppConfigService,
    private readonly jwtService: JwtService,
    private readonly hashing: OperatorHashingService,
    private readonly totp: OperatorTotpService,
    private readonly totpCipher: TotpSecretCipherService,
    private readonly rateLimiter: OperatorAuthRateLimiterService,
    private readonly securityEvents: OperatorSecurityEventsService,
    private readonly refreshTokens: OperatorRefreshTokensRepository,
    @InjectRepository(OperatorAccountEntity)
    private readonly operatorAccounts: Repository<OperatorAccountEntity>,
    @InjectRepository(OperatorLoginChallengeEntity)
    private readonly loginChallenges: Repository<OperatorLoginChallengeEntity>,
    @InjectRepository(OperatorRecoveryCodeEntity)
    private readonly recoveryCodes: Repository<OperatorRecoveryCodeEntity>,
  ) {}

  async login(
    email: string,
    password: string,
    ip: string,
  ): Promise<OperatorMfaRequiredResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    const [emailAllowed, ipAllowed] = await Promise.all([
      this.rateLimiter.consumeLoginAttempt(`email:${normalizedEmail}`),
      this.rateLimiter.consumeLoginAttempt(`ip:${ip}`),
    ]);
    if (!emailAllowed || !ipAllowed) {
      throw new UnauthorizedException('Too many login attempts. Try again later.');
    }

    const operator = await this.operatorAccounts.findOne({
      where: { email: normalizedEmail },
    });
    const passwordValid =
      operator !== null &&
      !operator.disabled &&
      (await this.hashing.verifyPassword(password, operator.passwordHash));
    if (!passwordValid) {
      await this.securityEvents.record({
        detail: { email: normalizedEmail },
        eventType: 'sign_in_failed',
        ip,
        operatorAccountId: operator?.id ?? null,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    const challenge = this.hashing.generateLoginChallenge();
    const expiresAt = new Date(
      Date.now() + OPERATOR_LOGIN_CHALLENGE_TTL_SECONDS * 1_000,
    );
    await this.loginChallenges.save(
      this.loginChallenges.create({
        challengeHash: this.hashing.hashOpaqueValue(challenge),
        consumedAt: null,
        expiresAt,
        operatorAccountId: operator.id,
      }),
    );

    return { challenge, expiresAt: expiresAt.toISOString(), status: 'mfa_required' };
  }

  async verifyMfa(
    input: { challenge: string; totpCode?: string; recoveryCode?: string },
    ip: string,
  ): Promise<OperatorSessionResponse> {
    if (
      (input.totpCode === undefined && input.recoveryCode === undefined) ||
      (input.totpCode !== undefined && input.recoveryCode !== undefined)
    ) {
      throw new BadRequestException(
        'Provide exactly one of totpCode or recoveryCode',
      );
    }

    const challengeHash = this.hashing.hashOpaqueValue(input.challenge);
    const rateAllowed = await this.rateLimiter.consumeMfaAttempt(
      `challenge:${challengeHash}`,
    );
    if (!rateAllowed) {
      throw new UnauthorizedException('Too many MFA attempts. Try again later.');
    }

    const challengeRow = await this.loginChallenges.findOne({
      where: { challengeHash },
    });
    if (
      challengeRow === null ||
      challengeRow.consumedAt !== null ||
      challengeRow.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }

    const operator = await this.operatorAccounts.findOneBy({
      id: challengeRow.operatorAccountId,
    });
    if (operator === null || operator.disabled) {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }

    const mfaValid =
      input.totpCode !== undefined
        ? this.totp.verify(
            input.totpCode,
            this.totpCipher.decrypt(operator.totpSecretEncrypted),
          )
        : await this.consumeRecoveryCode(operator.id, input.recoveryCode as string);

    if (!mfaValid) {
      await this.securityEvents.record({
        eventType: 'mfa_failed',
        ip,
        operatorAccountId: operator.id,
      });
      throw new UnauthorizedException('Invalid MFA code');
    }

    const consumed = await this.loginChallenges.update(
      { consumedAt: IsNull(), id: challengeRow.id },
      { consumedAt: new Date() },
    );
    if (consumed.affected !== 1) {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }

    await this.securityEvents.record({
      eventType: 'mfa_succeeded',
      ip,
      operatorAccountId: operator.id,
    });

    const tokens = await this.issueTokens(operator);
    return {
      ...tokens,
      operator: { email: operator.email, id: operator.id, role: operator.role },
    };
  }

  async refresh(refreshToken: string, ip: string): Promise<OperatorTokenPair> {
    const tokenHash = this.hashing.hashOpaqueValue(refreshToken);
    const nextRefreshToken = this.hashing.generateOpaqueRefreshToken();
    const outcome = await this.refreshTokens.rotate(
      tokenHash,
      this.hashing.hashOpaqueValue(nextRefreshToken),
      this.refreshExpiry(),
    );

    if (outcome.kind === 'reuse-detected') {
      await this.securityEvents.record({
        eventType: 'refresh_reuse_detected',
        ip,
        operatorAccountId: outcome.operatorAccountId,
      });
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (outcome.kind !== 'rotated') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const operator = await this.operatorAccounts.findOneBy({
      id: outcome.operatorAccountId,
    });
    if (operator === null || operator.disabled) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const accessToken = await this.signAccessToken(operator);
    return { accessToken, refreshToken: nextRefreshToken };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokens.revokeFamilyByTokenHash(
      this.hashing.hashOpaqueValue(refreshToken),
    );
  }

  private async consumeRecoveryCode(
    operatorAccountId: string,
    recoveryCode: string,
  ): Promise<boolean> {
    const codeHash = this.hashing.hashOpaqueValue(
      recoveryCode.trim().toUpperCase(),
    );
    const result = await this.recoveryCodes.update(
      { codeHash, operatorAccountId, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    return result.affected === 1;
  }

  private async issueTokens(
    operator: OperatorAccountEntity,
  ): Promise<OperatorTokenPair> {
    const accessToken = await this.signAccessToken(operator);
    const refreshToken = this.hashing.generateOpaqueRefreshToken();
    const created = await this.refreshTokens.createFamily(
      operator.id,
      this.hashing.hashOpaqueValue(refreshToken),
      randomUUID(),
      this.refreshExpiry(),
    );
    if (!created) {
      throw new UnauthorizedException('Operator account is disabled');
    }
    return { accessToken, refreshToken };
  }

  private signAccessToken(operator: OperatorAccountEntity): Promise<string> {
    const payload: OperatorAccessTokenPayload = {
      jti: randomUUID(),
      principalType: ADMIN_PRINCIPAL_TYPE,
      role: operator.role,
      sub: operator.id,
    };
    return this.jwtService.signAsync(payload);
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.adminRefreshTokenTtlSeconds * 1_000);
  }
}
