import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AuthSessionService } from './auth-session.service';
import {
  AuthPrincipal,
  AuthTokenPair,
  GuestAuthResponse,
} from './auth.types';
import { CurrentPrincipal } from './current-principal.decorator';
import { CreateGuestDto } from './dto/create-guest.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { GuestIdentityService } from './guest-identity.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly guestIdentity: GuestIdentityService,
    private readonly sessions: AuthSessionService,
  ) {}

  @Post('guest')
  createGuest(@Body() body: CreateGuestDto): Promise<GuestAuthResponse> {
    return this.guestIdentity.issue(
      body.installationKey,
      body.credentialSecret,
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshTokenDto): Promise<AuthTokenPair> {
    return this.sessions.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() body: RefreshTokenDto): Promise<void> {
    return this.sessions.logout(body.refreshToken);
  }

  @Get('session')
  @UseGuards(JwtAuthGuard)
  getSession(
    @CurrentPrincipal() principal: AuthPrincipal,
  ): AuthPrincipal {
    return principal;
  }
}
