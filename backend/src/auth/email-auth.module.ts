import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { AuthModule } from './auth.module';
import { EmailAuthController } from './email-auth.controller';
import { EmailOutboxDispatcherService } from './email-outbox-dispatcher.service';
import { EmailOutboxEntity } from './email-outbox.entity';
import { EmailOtpRateLimiterService } from './email-otp-rate-limiter.service';
import { EmailOtpService } from './email-otp.service';
import { EMAIL_SENDER, EmailSender } from './email-sender.interface';
import { LocalEmailSender } from './local-email-sender';
import { ResendEmailSender } from './resend-email-sender';
import {
  AuthIdentityEntity,
  EmailVerificationCodeEntity,
  RegisteredAccountEntity,
} from './entities';

@Module({
  controllers: [EmailAuthController],
  exports: [EmailOutboxDispatcherService, EmailOtpService, LocalEmailSender],
  imports: [
    AppConfigModule,
    AuthModule,
    TypeOrmModule.forFeature([
      AuthIdentityEntity,
      EmailOutboxEntity,
      EmailVerificationCodeEntity,
      RegisteredAccountEntity,
    ]),
  ],
  providers: [
    EmailOtpRateLimiterService,
    EmailOtpService,
    EmailOutboxDispatcherService,
    LocalEmailSender,
    ResendEmailSender,
    {
      inject: [AppConfigService, LocalEmailSender, ResendEmailSender],
      provide: EMAIL_SENDER,
      useFactory: (
        config: AppConfigService,
        local: LocalEmailSender,
        resend: ResendEmailSender,
      ): EmailSender => (config.resendApiKey === undefined ? local : resend),
    },
  ],
})
export class EmailAuthModule {}
