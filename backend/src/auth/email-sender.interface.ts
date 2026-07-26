export interface EmailOtpDelivery {
  code: string;
  codeId: string;
  deliveryId?: string;
  template?: 'email_otp';
  toEmail: string;
}

export interface ModerationNoticeEmailDelivery {
  deliveryId: string;
  noticeId: string;
  patternId: string;
  patternTitle: string;
  reason: string;
  template: 'moderation_notice';
  toEmail: string;
}

export type EmailDelivery = EmailOtpDelivery | ModerationNoticeEmailDelivery;

export interface EmailSender {
  send(delivery: EmailDelivery): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
