import { Injectable } from '@nestjs/common';

export type ProfileTextField = 'display name' | 'username';

const RESERVED_TOKENS = new Set([
  'admin',
  'administrator',
  'deleted',
  'moderator',
  'official',
  'restricted',
  'staff',
  'stitchwish',
  'support',
  'system',
  'team',
]);

const PROFANITY_TOKENS = new Set([
  'asshole',
  'bastard',
  'bitch',
  'cunt',
  'dick',
  'fuck',
  'motherfucker',
  'nigger',
  'pussy',
  'shit',
  'slut',
  'whore',
]);

@Injectable()
export class ProfileTextPolicyService {
  normalizeUsername(value: string): string {
    return value.normalize('NFKC').trim().toLowerCase();
  }

  normalizeDisplayName(value: string): string {
    return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  }

  rejectionReason(field: ProfileTextField, value: string): string | null {
    const tokens = this.tokens(value);
    const compact = this.compact(value);
    if (
      tokens.some((token) => RESERVED_TOKENS.has(token)) ||
      RESERVED_TOKENS.has(compact)
    ) {
      return `${this.label(field)} contains a reserved name`;
    }

    const hasProfanity =
      tokens.some((token) => PROFANITY_TOKENS.has(token)) ||
      PROFANITY_TOKENS.has(compact) ||
      (field === 'username' &&
        [...PROFANITY_TOKENS].some((word) => compact.includes(word)));
    if (hasProfanity) {
      return `${this.label(field)} contains language that is not allowed`;
    }

    return null;
  }

  private compact(value: string): string {
    return this.fold(value).replace(/[^a-z0-9]/g, '');
  }

  private fold(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/0/g, 'o')
      .replace(/[1!|]/g, 'i')
      .replace(/3/g, 'e')
      .replace(/4/g, 'a')
      .replace(/5/g, 's')
      .replace(/7/g, 't')
      .replace(/8/g, 'b');
  }

  private label(field: ProfileTextField): string {
    return field === 'username' ? 'Username' : 'Display name';
  }

  private tokens(value: string): string[] {
    return this.fold(value).split(/[^a-z0-9]+/).filter(Boolean);
  }
}
