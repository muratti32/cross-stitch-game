import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

import {
  OPERATOR_LOGIN_CHALLENGE_BYTES,
  OPERATOR_OPAQUE_REFRESH_TOKEN_BYTES,
  OPERATOR_RECOVERY_CODE_BYTES,
} from './admin.constants';

@Injectable()
export class OperatorHashingService {
  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    return argon2.verify(passwordHash, password);
  }

  generateOpaqueRefreshToken(): string {
    return randomBytes(OPERATOR_OPAQUE_REFRESH_TOKEN_BYTES).toString('base64url');
  }

  generateLoginChallenge(): string {
    return randomBytes(OPERATOR_LOGIN_CHALLENGE_BYTES).toString('base64url');
  }

  generateRecoveryCode(): string {
    // Grouped for readability, e.g. "9F3K7-2XQZ1-8B4C6-D0E1F2".
    const raw = randomBytes(OPERATOR_RECOVERY_CODE_BYTES)
      .toString('hex')
      .toUpperCase();
    const groups: string[] = [];
    for (let i = 0; i < raw.length; i += 5) {
      groups.push(raw.slice(i, i + 5));
    }
    return groups.join('-');
  }

  hashOpaqueValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
