import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import type { EmailOtpDelivery, EmailSender } from './email-sender.interface';

@Injectable()
export class ResendEmailSender implements EmailSender {
  constructor(private readonly config: AppConfigService) {}

  async send(delivery: EmailOtpDelivery): Promise<void> {
    const apiKey = this.config.resendApiKey;
    if (apiKey === undefined) {
      throw new Error('RESEND_API_KEY is required for Resend email delivery');
    }

    const response = await fetch('https://api.resend.com/emails', {
      body: JSON.stringify({
        click_tracking: false,
        from: this.config.emailFromAddress,
        html: `<p>Your verification code is <strong>${delivery.code}</strong>.</p>`,
        open_tracking: false,
        subject: 'Your verification code',
        to: [delivery.toEmail],
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Resend email delivery failed with status ${response.status}`);
    }
  }
}
