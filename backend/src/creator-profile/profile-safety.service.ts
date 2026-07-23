import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import { ProfileTextPolicyService } from './profile-text-policy.service';

export interface UploadedAvatar {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface CheckedAvatar {
  bytes: Buffer;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
}

@Injectable()
export class ProfileSafetyService {
  constructor(
    private readonly config: AppConfigService,
    private readonly textPolicy: ProfileTextPolicyService,
  ) {}

  checkText(username: string | undefined, displayName: string): void {
    if (username !== undefined) {
      const usernameReason = this.textPolicy.rejectionReason(
        'username',
        username,
      );
      if (usernameReason !== null) this.reject(usernameReason);
    }

    const displayNameReason = this.textPolicy.rejectionReason(
      'display name',
      displayName,
    );
    if (displayNameReason !== null) this.reject(displayNameReason);
  }

  async checkAvatar(upload: UploadedAvatar): Promise<CheckedAvatar> {
    const detected = detectAvatarType(upload.buffer);
    if (detected === null || detected.contentType !== upload.mimetype) {
      throw new BadRequestException('Avatar must be a valid JPEG, PNG, or WebP image');
    }

    if (!this.config.openAiModerationEnabled) {
      return { ...detected, bytes: upload.buffer };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Profile Safety Check is unavailable');
    }

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/moderations', {
        body: JSON.stringify({
          input: [
            {
              image_url: {
                url: `data:${detected.contentType};base64,${upload.buffer.toString('base64')}`,
              },
              type: 'image_url',
            },
          ],
          model: 'omni-moderation-latest',
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
    } catch {
      throw new ServiceUnavailableException('Profile Safety Check is unavailable');
    }

    if (!response.ok) {
      throw new ServiceUnavailableException('Profile Safety Check is unavailable');
    }

    let body: { results?: Array<{ flagged?: unknown }> };
    try {
      body = (await response.json()) as {
        results?: Array<{ flagged?: unknown }>;
      };
    } catch {
      throw new ServiceUnavailableException('Profile Safety Check is unavailable');
    }
    const flagged = body.results?.[0]?.flagged;
    if (typeof flagged !== 'boolean') {
      throw new ServiceUnavailableException('Profile Safety Check is unavailable');
    }
    if (flagged) this.reject('Avatar was rejected by the safety check');

    return { ...detected, bytes: upload.buffer };
  }

  private reject(reason: string): never {
    throw new UnprocessableEntityException({
      code: 'PROFILE_SAFETY_REJECTED',
      message: reason,
      reason,
    });
  }
}

function detectAvatarType(
  bytes: Buffer,
): Omit<CheckedAvatar, 'bytes'> | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return null;
}
