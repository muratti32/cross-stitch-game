import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthSessionService } from './auth-session.service';
import { AccountAuthResponse } from './auth.types';
import { RequestEmailOtpDto } from './dto/request-email-otp.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';
import { EmailOtpService } from './email-otp.service';
import { CommercePromotionService } from '../promotion/commerce-promotion.service';

interface EmailRequestResponse {
  status: 'sent';
}

@Controller('auth/email')
export class EmailAuthController {
  private readonly logger = new Logger(EmailAuthController.name);

  constructor(
    private readonly emailOtp: EmailOtpService,
    private readonly sessions: AuthSessionService,
    private readonly commercePromotion: CommercePromotionService,
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
    const handoff = await this.startCommercePromotion(accountId, body.guestId, body.guestCredential);
    return { accountId, ...tokens, ...(handoff === undefined ? {} : { commerceHandoffId: handoff.handoffId, syncingPurchases: handoff.syncingPurchases }) };
  }

  private async startCommercePromotion(accountId: string, guestId?: string, guestCredential?: string) {
    if (guestId === undefined || guestCredential === undefined) return undefined;
    try {
      return await this.commercePromotion.start(accountId, guestId, guestCredential);
    } catch (error: unknown) {
      this.logger.warn(`Commerce promotion handoff could not be created: ${error instanceof Error ? error.message : 'unknown error'}`);
      return undefined;
    }
  }
}
