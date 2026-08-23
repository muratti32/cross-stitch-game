import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  AccountReauthenticationResult,
  AccountReauthenticationService,
  LinkedAuthIdentity,
} from './account-reauthentication.service';
import { AuthPrincipal } from './auth.types';
import { CurrentPrincipal } from './current-principal.decorator';
import { ReauthenticateEmailDto } from './dto/reauthenticate-email.dto';
import { ReauthenticateFirebaseDto } from './dto/reauthenticate-firebase.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('account/reauthenticate')
@UseGuards(JwtAuthGuard)
export class AccountReauthenticationController {
  constructor(
    private readonly reauthentication: AccountReauthenticationService,
  ) {}

  @Get('identities')
  async identities(
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<{ identities: readonly LinkedAuthIdentity[] }> {
    return { identities: await this.reauthentication.listLinkedIdentities(principal) };
  }

  @Post('firebase')
  @HttpCode(HttpStatus.OK)
  firebase(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: ReauthenticateFirebaseDto,
  ): Promise<AccountReauthenticationResult> {
    return this.reauthentication.withFirebaseIdToken(principal, body.idToken);
  }

  @Post('email')
  @HttpCode(HttpStatus.OK)
  email(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: ReauthenticateEmailDto,
  ): Promise<AccountReauthenticationResult> {
    return this.reauthentication.withEmailOtp(principal, body.email, body.code);
  }
}
