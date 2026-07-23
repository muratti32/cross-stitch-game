import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';

import { AccountIdentityService } from './account-identity.service';
import { CurrentPrincipal } from './current-principal.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthPrincipal } from './auth.types';
import { PrincipalType } from './entities';
import { LinkFirebaseDto } from './dto/link-firebase.dto';
import { LinkEmailDto } from './dto/link-email.dto';
import { UnlinkIdentityDto } from './dto/unlink-identity.dto';
import { EmailOtpService } from './email-otp.service';
import {
  FIREBASE_IDENTITY_VERIFIER,
  FirebaseIdentityVerifier,
} from './firebase-identity-verifier';

@Controller('auth/identities')
@UseGuards(JwtAuthGuard)
export class AuthIdentitiesController {
  constructor(
    private readonly accountIdentities: AccountIdentityService,
    private readonly emailOtp: EmailOtpService,
    @Inject(FIREBASE_IDENTITY_VERIFIER)
    private readonly firebaseVerifier: FirebaseIdentityVerifier,
  ) {}

  @Post('link/firebase')
  @HttpCode(HttpStatus.NO_CONTENT)
  async linkFirebase(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: LinkFirebaseDto,
  ): Promise<void> {
    this.ensureAccountPrincipal(principal);
    this.ensureRecentReauthentication(principal);

    const verified = await this.firebaseVerifier.verify(body.idToken);
    await this.accountIdentities.link(principal.id, verified);
  }

  @Post('link/email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async linkEmail(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: LinkEmailDto,
  ): Promise<void> {
    this.ensureAccountPrincipal(principal);
    this.ensureRecentReauthentication(principal);

    await this.emailOtp.verifyAndLink(
      principal.id,
      body.email,
      body.code,
    );
  }

  @Post('unlink')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlink(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: UnlinkIdentityDto,
  ): Promise<void> {
    this.ensureAccountPrincipal(principal);
    this.ensureRecentReauthentication(principal);

    await this.accountIdentities.unlink(
      principal.id,
      body.provider,
      body.subject,
    );
  }

  private ensureAccountPrincipal(principal: AuthPrincipal): void {
    if (principal.type !== PrincipalType.Account) {
      throw new UnauthorizedException('Principal must be a registered account');
    }
  }

  private ensureRecentReauthentication(principal: AuthPrincipal): void {
    const REAUTH_WINDOW_SECONDS = 300; // 5 minutes
    const currentEpoch = Math.floor(Date.now() / 1000);
    if (
      principal.authTime === undefined ||
      currentEpoch - principal.authTime > REAUTH_WINDOW_SECONDS
    ) {
      throw new UnauthorizedException('Recent reauthentication required');
    }
  }
}
