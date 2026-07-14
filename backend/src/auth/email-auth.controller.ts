import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthSessionService } from './auth-session.service';
import { AccountAuthResponse } from './auth.types';
import { RequestEmailOtpDto } from './dto/request-email-otp.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';
import { EmailOtpService } from './email-otp.service';

interface EmailRequestResponse {
  status: 'sent';
}

@Controller('auth/email')
export class EmailAuthController {
  constructor(
    private readonly emailOtp: EmailOtpService,
    private readonly sessions: AuthSessionService,
  ) {}

  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  async request(
    @Body() body: RequestEmailOtpDto,
    @Ip() ip: string,
  ): Promise<EmailRequestResponse> {
    await this.emailOtp.request(body.email, ip);
    return { status: 'sent' };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Body() body: VerifyEmailOtpDto): Promise<AccountAuthResponse> {
    const accountId = await this.emailOtp.verify(body.email, body.code);
    if (accountId === null) {
      throw new UnauthorizedException('Invalid email verification code');
    }
    const tokens = await this.sessions.issueForAccount(accountId);
    return { accountId, ...tokens };
  }
}
