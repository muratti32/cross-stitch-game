import { Injectable, Logger } from '@nestjs/common';

import type { EmailOtpDelivery, EmailSender } from './email-sender.interface';

@Injectable()
export class LocalEmailSender implements EmailSender {
  private readonly logger = new Logger(LocalEmailSender.name);
  private readonly deliveries: EmailOtpDelivery[] = [];

  send(delivery: EmailOtpDelivery): Promise<void> {
    this.deliveries.push({ ...delivery });
    this.logger.log(`Local email delivery recorded for ${delivery.toEmail}`);
    return Promise.resolve();
  }

  getDeliveries(): readonly EmailOtpDelivery[] {
    return this.deliveries;
  }
}
