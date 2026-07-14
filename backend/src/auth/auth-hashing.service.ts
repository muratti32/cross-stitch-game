import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';

import {
  CREDENTIAL_BCRYPT_ROUNDS,
  OPAQUE_REFRESH_TOKEN_BYTES,
} from './auth.constants';

@Injectable()
export class AuthHashingService {
  hashInstallationKey(installationKey: string): string {
    return this.sha256(installationKey.toLowerCase());
  }

  hashOpaqueToken(token: string): string {
    return this.sha256(token);
  }

  generateOpaqueRefreshToken(): string {
    return randomBytes(OPAQUE_REFRESH_TOKEN_BYTES).toString('base64url');
  }

  hashCredentialSecret(credentialSecret: string): Promise<string> {
    return hash(this.sha256(credentialSecret), CREDENTIAL_BCRYPT_ROUNDS);
  }

  verifyCredentialSecret(
    credentialSecret: string,
    credentialHash: string,
  ): Promise<boolean> {
    return compare(this.sha256(credentialSecret), credentialHash);
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
