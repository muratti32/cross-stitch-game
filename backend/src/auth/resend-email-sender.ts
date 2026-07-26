import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import type { EmailDelivery, EmailSender } from './email-sender.interface';

@Injectable()
export class ResendEmailSender implements EmailSender {
  constructor(private readonly config: AppConfigService) {}

  async send(delivery: EmailDelivery): Promise<void> {
    const apiKey = this.config.resendApiKey;
    if (apiKey === undefined) {
      throw new Error('RESEND_API_KEY is required for Resend email delivery');
    }

    const content = emailContent(delivery);
    const deliveryId =
      delivery.template === 'moderation_notice'
        ? delivery.deliveryId
        : delivery.deliveryId ?? delivery.codeId;
    const response = await fetch('https://api.resend.com/emails', {
      body: JSON.stringify({
        click_tracking: false,
        from: this.config.emailFromAddress,
        html: content.html,
        open_tracking: false,
        subject: content.subject,
        to: [delivery.toEmail],
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': deliveryId,
      },
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Resend email delivery failed with status ${response.status}`);
    }
  }
}

function emailContent(delivery: EmailDelivery): { html: string; subject: string } {
  if (delivery.template === 'moderation_notice') {
    return {
      html: `<p>A Review Hold was applied to <strong>${escapeHtml(delivery.patternTitle)}</strong>.</p><p>${escapeHtml(delivery.reason)}</p><p>Existing Stitching Sessions remain playable, but the Pattern is temporarily unavailable for discovery and new sessions.</p>`,
      subject: `Review Hold applied to ${delivery.patternTitle}`,
    };
  }
  return {
    html: `<p>Your verification code is <strong>${delivery.code}</strong>.</p>`,
    subject: 'Your verification code',
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
