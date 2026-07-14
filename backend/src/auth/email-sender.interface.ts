export interface EmailOtpDelivery {
  code: string;
  codeId: string;
  toEmail: string;
}

export interface EmailSender {
  send(delivery: EmailOtpDelivery): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
