import {
  generateKeyPairSync,
  KeyObject,
  sign as cryptoSign,
} from 'node:crypto';

import { BadRequestException } from '@nestjs/common';

import { AdMobSsvVerifierService } from './admob-ssv-verifier.service';
import type { AppConfigService } from '../config/app-config.service';

const KEY_ID = 3335741209;
const KEYS_URL = 'https://verifier.test/keys.json';

function configStub(): AppConfigService {
  return {
    admobSsvKeysUrl: KEYS_URL,
    admobSsvAllowedAdUnits: [],
  } as unknown as AppConfigService;
}

function signContent(content: string, privateKey: KeyObject): string {
  const signature = cryptoSign(
    'sha256',
    Buffer.from(content, 'utf8'),
    { key: privateKey, dsaEncoding: 'der' },
  );
  return signature.toString('base64url');
}

describe('AdMobSsvVerifierService', () => {
  let publicKeyPem: string;
  let privateKey: KeyObject;
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;

  // Content signed by AdMob: every param up to (but excluding) `signature`.
  const content =
    'ad_network=5450213213286189855&ad_unit=ca-app-pub-3940256099942544%2F5224354917' +
    '&custom_data=guest%3A11111111-1111-4111-8111-111111111111' +
    '&reward_amount=10&reward_item=coins&timestamp=1700000000000' +
    '&transaction_id=abc123&user_id=';

  beforeAll(() => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    privateKey = pair.privateKey;
    publicKeyPem = pair.publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;
  });

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [{ keyId: KEY_ID, pem: publicKeyPem }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  function rawQueryFor(signedContent: string, deliveredContent = signedContent) {
    const signature = signContent(signedContent, privateKey);
    return `${deliveredContent}&signature=${signature}&key_id=${KEY_ID}`;
  }

  it('verifies a valid callback and returns the parsed reward', async () => {
    const service = new AdMobSsvVerifierService(configStub());

    const reward = await service.verify(rawQueryFor(content));

    expect(reward.transactionId).toBe('abc123');
    expect(reward.customData).toBe('guest:11111111-1111-4111-8111-111111111111');
    expect(reward.rewardAmount).toBe('10');
    expect(fetchMock).toHaveBeenCalledWith(KEYS_URL);
  });

  it('caches keys and does not refetch on the second callback', async () => {
    const service = new AdMobSsvVerifierService(configStub());

    await service.verify(rawQueryFor(content));
    await service.verify(rawQueryFor(content));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a callback whose content was tampered after signing', async () => {
    const service = new AdMobSsvVerifierService(configStub());
    // Sign the honest content but deliver a mutated reward_amount.
    const tampered = content.replace('reward_amount=10', 'reward_amount=9999');

    await expect(service.verify(rawQueryFor(content, tampered))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a callback signed by an unknown key id', async () => {
    const service = new AdMobSsvVerifierService(configStub());
    const signature = signContent(content, privateKey);
    const rawQuery = `${content}&signature=${signature}&key_id=999999`;

    await expect(service.verify(rawQuery)).rejects.toThrow(BadRequestException);
  });

  it('rejects a callback with no signature parameter', async () => {
    const service = new AdMobSsvVerifierService(configStub());

    await expect(service.verify(content)).rejects.toThrow(BadRequestException);
  });
});
