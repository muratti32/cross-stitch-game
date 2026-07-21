import { createPublicKey, verify as cryptoVerify, KeyObject } from 'node:crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';

export interface AdMobSsvReward {
  transactionId: string;
  customData: string;
  rewardAmount: string;
  rewardItem: string;
  adUnit: string;
  adNetwork: string;
  userId: string;
  timestamp: string;
}

interface VerifierKeyEntry {
  keyId: number;
  pem?: string;
  base64?: string;
}

interface VerifierKeysResponse {
  keys?: readonly VerifierKeyEntry[];
}

// AdMob signs with ECDSA over the P-256 curve; the signature bytes are DER.
const SIGNATURE_ALGORITHM = 'sha256';
// Refetch the key set at most this often when a key_id is already cached.
const KEY_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Verifies AdMob Server-Side Verification (SSV) callbacks (ADR-0033). AdMob
 * signs the callback with a rotating ECDSA key; we fetch the public keys from
 * Google, cache them by key id, and verify the signature over the exact query
 * string content AdMob signed. A verified callback is the only trusted signal
 * that a Rewarded Ad was completed.
 */
@Injectable()
export class AdMobSsvVerifierService {
  private readonly logger = new Logger(AdMobSsvVerifierService.name);
  private keysByKeyId = new Map<number, KeyObject>();
  private lastFetchedAt = 0;

  constructor(private readonly config: AppConfigService) {}

  /**
   * Verify a raw SSV callback query string (without the leading `?`) and return
   * the parsed reward. Throws {@link BadRequestException} when the signature is
   * missing, malformed, or does not verify.
   */
  async verify(rawQuery: string): Promise<AdMobSsvReward> {
    // Per AdMob, `signature` and `key_id` are always the final two params and
    // everything before them is the signed content. Reparsing would reorder or
    // re-encode the params, so slice the raw string instead.
    const signatureMarker = '&signature=';
    const signatureIndex = rawQuery.indexOf(signatureMarker);
    if (signatureIndex < 0) {
      throw new BadRequestException('SSV callback is missing a signature');
    }
    const contentToVerify = rawQuery.slice(0, signatureIndex);

    const params = new URLSearchParams(rawQuery);
    const signatureParam = params.get('signature');
    const keyIdParam = params.get('key_id');
    if (
      signatureParam === null ||
      signatureParam.length === 0 ||
      keyIdParam === null ||
      !/^\d+$/.test(keyIdParam)
    ) {
      throw new BadRequestException('SSV callback signature is malformed');
    }
    const keyId = Number(keyIdParam);

    let signature: Buffer;
    try {
      signature = Buffer.from(signatureParam, 'base64url');
    } catch {
      throw new BadRequestException('SSV callback signature is malformed');
    }
    if (signature.length === 0) {
      throw new BadRequestException('SSV callback signature is malformed');
    }

    const key = await this.resolveKey(keyId);
    if (key === null) {
      throw new BadRequestException(
        'SSV callback references an unknown verification key',
      );
    }

    const valid = cryptoVerify(
      SIGNATURE_ALGORITHM,
      Buffer.from(contentToVerify, 'utf8'),
      { key, dsaEncoding: 'der' },
      signature,
    );
    if (!valid) {
      throw new BadRequestException('SSV callback signature is invalid');
    }

    return {
      transactionId: params.get('transaction_id') ?? '',
      customData: params.get('custom_data') ?? '',
      rewardAmount: params.get('reward_amount') ?? '',
      rewardItem: params.get('reward_item') ?? '',
      adUnit: params.get('ad_unit') ?? '',
      adNetwork: params.get('ad_network') ?? '',
      userId: params.get('user_id') ?? '',
      timestamp: params.get('timestamp') ?? '',
    };
  }

  private async resolveKey(keyId: number): Promise<KeyObject | null> {
    const cached = this.keysByKeyId.get(keyId);
    if (cached !== undefined) {
      return cached;
    }
    // Unknown key id: either the cache is cold or AdMob rotated keys. Refetch,
    // but don't hammer Google if we just refreshed.
    if (Date.now() - this.lastFetchedAt > KEY_CACHE_TTL_MS) {
      await this.refreshKeys();
    }
    return this.keysByKeyId.get(keyId) ?? null;
  }

  private async refreshKeys(): Promise<void> {
    const url = this.config.admobSsvKeysUrl;
    let payload: VerifierKeysResponse;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`unexpected status ${response.status}`);
      }
      payload = (await response.json()) as VerifierKeysResponse;
    } catch (error) {
      this.logger.error(
        `Failed to fetch AdMob verifier keys from ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    const next = new Map<number, KeyObject>();
    for (const entry of payload.keys ?? []) {
      const pem = entry.pem ?? this.pemFromBase64(entry.base64);
      if (typeof entry.keyId !== 'number' || pem === null) {
        continue;
      }
      try {
        next.set(entry.keyId, createPublicKey(pem));
      } catch (error) {
        this.logger.warn(
          `Skipping malformed AdMob verifier key ${entry.keyId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (next.size > 0) {
      this.keysByKeyId = next;
      this.lastFetchedAt = Date.now();
    }
  }

  private pemFromBase64(base64?: string): string | null {
    if (base64 === undefined || base64.length === 0) {
      return null;
    }
    const body = base64.replace(/\s+/g, '').replace(/(.{64})/g, '$1\n');
    return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
  }
}
