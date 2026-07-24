import { Injectable, Logger } from '@nestjs/common';

import type {
  EmailDelivery,
  EmailOtpDelivery,
  EmailSender,
  ModerationNoticeEmailDelivery,
} from './email-sender.interface';

@Injectable()
export class LocalEmailSender implements EmailSender {
  private readonly logger = new Logger(LocalEmailSender.name);
  private readonly deliveries: EmailDelivery[] = [];

  send(delivery: EmailDelivery): Promise<void> {
    this.deliveries.push({ ...delivery });
    this.logger.log(`Local email delivery recorded for ${delivery.toEmail}`);
    return Promise.resolve();
  }

  getDeliveries(): readonly EmailOtpDelivery[] {
    return this.deliveries.filter(
      (delivery): delivery is EmailOtpDelivery =>
        delivery.template === undefined || delivery.template === 'email_otp',
    );
  }

  getModerationNoticeDeliveries(): readonly ModerationNoticeEmailDelivery[] {
    return this.deliveries.filter(
      (delivery): delivery is ModerationNoticeEmailDelivery =>
        delivery.template === 'moderation_notice',
    );
  }
}
