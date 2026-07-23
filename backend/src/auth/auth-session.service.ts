import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';

import { AppConfigService } from '../config/app-config.service';
import { ACCESS_TOKEN_VERSION } from './auth.constants';
import { AuthHashingService } from './auth-hashing.service';
import {
  AccessTokenPayload,
  AuthPrincipal,
  AuthTokenPair,
} from './auth.types';
import { PrincipalType } from './entities';
import { RefreshTokensRepository } from './refresh-tokens.repository';

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly config: AppConfigService,
    private readonly hashing: AuthHashingService,
    private readonly jwtService: JwtService,
    private readonly refreshTokens: RefreshTokensRepository,
  ) {}

  async issueForGuest(guestId: string): Promise<AuthTokenPair> {
    return this.issue(PrincipalType.Guest, guestId);
  }

  async issueForAccount(accountId: string): Promise<AuthTokenPair> {
    return this.issue(PrincipalType.Account, accountId);
  }

  private async issue(
    principalType: PrincipalType,
    principalId: string,
  ): Promise<AuthTokenPair> {
    const principal: AuthPrincipal = {
      id: principalId,
      tokenVersion: ACCESS_TOKEN_VERSION,
      type: principalType,
    };
    const refreshToken = this.hashing.generateOpaqueRefreshToken();
    const tokenHash = this.hashing.hashOpaqueToken(refreshToken);
    const authTime = Math.floor(Date.now() / 1000);
    const accessToken = await this.signAccessToken(principal, authTime);

    const familyCreated = await this.refreshTokens.createFamily(
      principal.type,
      principal.id,
      tokenHash,
      randomUUID(),
      this.getRefreshExpiry(),
    );
    if (!familyCreated) {
      throw new UnauthorizedException('Invalid guest credentials');
    }

    return {
      accessToken,
      refreshToken,
    };
  }

  async refresh(refreshToken: string): Promise<AuthTokenPair> {
    const tokenHash = this.hashing.hashOpaqueToken(refreshToken);
    const currentPrincipal =
      await this.refreshTokens.findPrincipalByTokenHash(tokenHash);
    if (currentPrincipal === null) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const authTime = await this.refreshTokens.getFamilyAuthTime(tokenHash);
    if (authTime === null) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const accessToken = await this.signAccessToken({
      id: currentPrincipal.principalId,
      tokenVersion: ACCESS_TOKEN_VERSION,
      type: currentPrincipal.principalType,
    }, authTime);
    const nextRefreshToken = this.hashing.generateOpaqueRefreshToken();
    const outcome = await this.refreshTokens.rotate(
      tokenHash,
      this.hashing.hashOpaqueToken(nextRefreshToken),
      this.getRefreshExpiry(),
    );

    if (outcome.kind !== 'rotated') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      accessToken,
      refreshToken: nextRefreshToken,
    };
  }

  logout(refreshToken: string): Promise<void> {
    return this.refreshTokens.revokeFamilyByTokenHash(
      this.hashing.hashOpaqueToken(refreshToken),
    );
  }

  private getRefreshExpiry(): Date {
    return new Date(
      Date.now() + this.config.refreshTokenTtlSeconds * 1_000,
    );
  }

  private signAccessToken(principal: AuthPrincipal, authTime?: number): Promise<string> {
    const payload: AccessTokenPayload = {
      jti: randomUUID(),
      principalType: principal.type,
      sub: principal.id,
      tokenVersion: principal.tokenVersion,
      authTime,
    };
    return this.jwtService.signAsync(payload);
  }
}
