import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { AuthController } from './auth.controller';
import { AccountIdentityService } from './account-identity.service';
import { AuthHashingService } from './auth-hashing.service';
import { AuthSessionService } from './auth-session.service';
import {
  GuestInstallationEntity,
  AuthIdentityEntity,
  RefreshTokenEntity,
  RegisteredAccountEntity,
} from './entities';
import { GuestIdentityService } from './guest-identity.service';
import { GuestInstallationsRepository } from './guest-installations.repository';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { RefreshTokensRepository } from './refresh-tokens.repository';

import { InvalidatedNamespaceTokenModule } from '../deletion/invalidated-namespace-token.module';

@Module({
  controllers: [AuthController],
  // JwtModule is re-exported so modules importing AuthModule (e.g. SessionsModule)
  // can instantiate JwtAuthGuard via @UseGuards, which depends on JwtService.
  exports: [AccountIdentityService, AuthSessionService, JwtAuthGuard, OptionalJwtAuthGuard, JwtModule, GuestInstallationsRepository, AuthHashingService, RefreshTokensRepository],
  imports: [
    AppConfigModule,
    InvalidatedNamespaceTokenModule,
    TypeOrmModule.forFeature([
      GuestInstallationEntity,
      AuthIdentityEntity,
      RefreshTokenEntity,
      RegisteredAccountEntity,
    ]),
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwtSecret,
        signOptions: {
          algorithm: 'HS256' as const,
          expiresIn: config.jwtAccessTtlSeconds,
        },
      }),
    }),
  ],
  providers: [
    AccountIdentityService,
    AuthHashingService,
    AuthSessionService,
    GuestIdentityService,
    GuestInstallationsRepository,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    RefreshTokensRepository,
  ],
})
export class AuthModule {}
