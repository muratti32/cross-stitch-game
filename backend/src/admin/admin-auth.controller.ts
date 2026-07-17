import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';

import { OperatorLoginDto } from './dto/operator-login.dto';
import { OperatorMfaDto } from './dto/operator-mfa.dto';
import { OperatorRefreshTokenDto } from './dto/operator-refresh-token.dto';
import {
  OperatorAuthService,
  OperatorMfaRequiredResponse,
  OperatorSessionResponse,
} from './operator-auth.service';
import { OperatorTokenPair } from './operator-auth.types';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly operatorAuth: OperatorAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body() body: OperatorLoginDto,
    @Ip() ip: string,
  ): Promise<OperatorMfaRequiredResponse> {
    return this.operatorAuth.login(body.email, body.password, ip);
  }

  @Post('mfa')
  @HttpCode(HttpStatus.OK)
  verifyMfa(
    @Body() body: OperatorMfaDto,
    @Ip() ip: string,
  ): Promise<OperatorSessionResponse> {
    return this.operatorAuth.verifyMfa(
      { challenge: body.challenge, recoveryCode: body.recoveryCode, totpCode: body.totpCode },
      ip,
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body() body: OperatorRefreshTokenDto,
    @Ip() ip: string,
  ): Promise<OperatorTokenPair> {
    return this.operatorAuth.refresh(body.refreshToken, ip);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: OperatorRefreshTokenDto): Promise<void> {
    await this.operatorAuth.logout(body.refreshToken);
  }
}
