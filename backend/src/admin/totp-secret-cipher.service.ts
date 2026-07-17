import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

import { AppConfigService } from '../config/app-config.service';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Operator TOTP secrets must be reversible (the raw secret is needed to
 * compute a comparison code), so they are encrypted at rest with
 * ADMIN_TOTP_ENC_KEY rather than hashed like passwords or refresh tokens.
 */
@Injectable()
export class TotpSecretCipherService {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    this.key = Buffer.from(config.adminTotpEncryptionKey, 'hex');
  }

  encrypt(plainTextSecret: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plainTextSecret, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  }

  decrypt(encrypted: string): string {
    const parts = encrypted.split('.');
    if (parts.length !== 3) {
      throw new Error('Encrypted operator TOTP secret is malformed');
    }
    const [ivPart, authTagPart, ciphertextPart] = parts;
    const iv = Buffer.from(ivPart, 'base64');
    const authTag = Buffer.from(authTagPart, 'base64');
    const ciphertext = Buffer.from(ciphertextPart, 'base64');
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
