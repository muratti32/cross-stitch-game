import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';

import { AppConfigService } from '../config/app-config.service';

const TOTP_WINDOW_STEPS = 1; // tolerate +/-1 step (30s) of clock drift

/**
 * Thin wrapper around otplib's authenticator preset: generates secrets and
 * otpauth:// URIs for enrollment, and verifies a submitted code against a
 * decrypted secret with a small clock-drift tolerance.
 */
@Injectable()
export class OperatorTotpService {
  private readonly verifier: typeof authenticator;

  constructor(private readonly config: AppConfigService) {
    this.verifier = authenticator.clone({ window: TOTP_WINDOW_STEPS });
  }

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  keyUri(email: string, secret: string): string {
    return authenticator.keyuri(email, this.config.adminTotpIssuer, secret);
  }

  verify(token: string, secret: string): boolean {
    if (!/^\d{6}$/.test(token)) {
      return false;
    }
    try {
      return this.verifier.check(token, secret);
    } catch {
      return false;
    }
  }
}
