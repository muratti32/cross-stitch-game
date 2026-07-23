import { BadRequestException } from '@nestjs/common';

import type { AppConfigService } from '../config/app-config.service';
import type {
  AdMobSsvReward,
  AdMobSsvVerifierService,
} from './admob-ssv-verifier.service';
import type {
  AdRewardGrantResult,
  CoinLedgerRepository,
  LedgerPrincipal,
} from './coin-ledger.repository';
import { RewardGrantService } from './reward-grant.service';
import { utcRewardDay } from './reward-day';
import { AdAttemptRepository } from './ad-attempt.repository';

const GUEST_ID = '11111111-1111-4111-8111-111111111111';

interface ExistingAdGrant {
  principal: LedgerPrincipal;
  granted: boolean;
  amount: number;
}

function rewardFixture(overrides: Partial<AdMobSsvReward> = {}): AdMobSsvReward {
  return {
    transactionId: 'txn-1',
    customData: 'valid-nonce-uuid',
    rewardAmount: '10',
    rewardItem: 'coins',
    adUnit: 'ca-app-pub-3940256099942544/5224354917',
    adNetwork: '5450213213286189855',
    userId: '',
    timestamp: '1700000000000',
    ...overrides,
  };
}

function grantResult(
  overrides: Partial<AdRewardGrantResult> = {},
): AdRewardGrantResult {
  return {
    granted: true,
    amount: 10,
    balance: 10,
    adsCompleted: 1,
    coinsConsumed: 10,
    replayed: false,
    ...overrides,
  };
}

function makeService(options: {
  reward: AdMobSsvReward;
  allowedAdUnits?: readonly string[];
  grant?: jest.Mock;
  consume?: jest.Mock;
  balance?: jest.Mock;
  rewardDayStatus?: jest.Mock;
  findExistingAdGrant?: jest.Mock;
}): {
  service: RewardGrantService;
  grant: jest.Mock;
  consume: jest.Mock;
  balance: jest.Mock;
  rewardDayStatus: jest.Mock;
  findExistingAdGrant: jest.Mock;
} {
  const verifier = {
    verify: jest.fn().mockResolvedValue(options.reward),
  } as unknown as AdMobSsvVerifierService;
  const grant = options.grant ?? jest.fn().mockResolvedValue(grantResult());
  const balance = options.balance ?? jest.fn().mockResolvedValue(10);
  const rewardDayStatus =
    options.rewardDayStatus ??
    jest.fn().mockResolvedValue({ adsCompleted: 1, coinsConsumed: 10 });
  const findExistingAdGrant =
    options.findExistingAdGrant ?? jest.fn().mockResolvedValue(null);
  const ledger = {
    grantAdReward: grant,
    getBalance: balance,
    getRewardDayStatus: rewardDayStatus,
    findExistingAdGrant,
  } as unknown as CoinLedgerRepository;
  const config = {
    admobSsvAllowedAdUnits: options.allowedAdUnits ?? [],
  } as unknown as AppConfigService;
  const consume =
    options.consume ?? jest.fn().mockResolvedValue({ type: 'guest', id: GUEST_ID });
  const adAttempts = {
    consume,
  } as unknown as AdAttemptRepository;
  return {
    service: new RewardGrantService(verifier, ledger, config, adAttempts),
    grant,
    consume,
    balance,
    rewardDayStatus,
    findExistingAdGrant,
  };
}

describe('RewardGrantService', () => {
  it('grants a verified guest callback idempotently by transaction id', async () => {
    const { service, grant, consume } = makeService({
      reward: rewardFixture({ customData: 'nonce-1' }),
    });

    const result = await service.processAdCallback('raw=query');

    expect(consume).toHaveBeenCalledWith('nonce-1');
    expect(grant).toHaveBeenCalledWith(
      { type: 'guest', id: GUEST_ID },
      utcRewardDay(),
      'ad:txn-1',
    );
    expect(result.granted).toBe(true);
    expect(result.transactionId).toBe('txn-1');
  });

  it('replays an existing grant by transaction id WITHOUT re-consuming the nonce', async () => {
    const existing: ExistingAdGrant = {
      principal: { type: 'guest', id: GUEST_ID },
      granted: true,
      amount: 10,
    };
    const findExistingAdGrant = jest.fn().mockResolvedValue(existing);
    const balance = jest.fn().mockResolvedValue(40);
    const rewardDayStatus = jest
      .fn()
      .mockResolvedValue({ adsCompleted: 3, coinsConsumed: 30 });
    const { service, consume, grant } = makeService({
      reward: rewardFixture({ customData: 'already-consumed-nonce' }),
      findExistingAdGrant,
      balance,
      rewardDayStatus,
    });

    const result = await service.processAdCallback('raw=query');

    expect(result).toMatchObject({
      granted: true,
      amount: 10,
      balance: 40,
      adsCompleted: 3,
      coinsConsumed: 30,
      replayed: true,
      transactionId: 'txn-1',
    });
    expect(findExistingAdGrant).toHaveBeenCalledWith('ad:txn-1');
    expect(consume).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
  });

  it('recovers a concurrent nonce consume when the grant now exists', async () => {
    const existing: ExistingAdGrant = {
      principal: { type: 'guest', id: GUEST_ID },
      granted: true,
      amount: 10,
    };
    const findExistingAdGrant = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    const consume = jest.fn().mockResolvedValue(null);
    const { service, grant } = makeService({
      reward: rewardFixture({ customData: 'concurrently-consumed-nonce' }),
      consume,
      findExistingAdGrant,
    });

    const result = await service.processAdCallback('raw=query');

    expect(result).toMatchObject({
      granted: true,
      amount: 10,
      replayed: true,
      transactionId: 'txn-1',
    });
    expect(consume).toHaveBeenCalledWith('concurrently-consumed-nonce');
    expect(findExistingAdGrant).toHaveBeenCalledTimes(2);
    expect(grant).not.toHaveBeenCalled();
  });

  it('resolves an account principal from nonce', async () => {
    const accountId = '22222222-2222-4222-8222-222222222222';
    const consume = jest.fn().mockResolvedValue({ type: 'account', id: accountId });
    const { service, grant } = makeService({
      reward: rewardFixture({ customData: 'nonce-2' }),
      consume,
    });

    await service.processAdCallback('raw=query');

    expect(consume).toHaveBeenCalledWith('nonce-2');
    expect(grant).toHaveBeenCalledWith(
      { type: 'account', id: accountId },
      expect.any(String),
      'ad:txn-1',
    );
  });

  it('rejects invalid, expired or already used nonce without granting', async () => {
    const consume = jest.fn().mockResolvedValue(null);
    const { service, grant } = makeService({
      reward: rewardFixture({ customData: 'invalid-nonce' }),
      consume,
    });

    await expect(service.processAdCallback('raw=query')).rejects.toThrow(
      BadRequestException,
    );
    expect(consume).toHaveBeenCalledWith('invalid-nonce');
    expect(grant).not.toHaveBeenCalled();
  });

  it('rejects a callback with an empty transaction id', async () => {
    const { service, grant } = makeService({
      reward: rewardFixture({ transactionId: '' }),
    });

    await expect(service.processAdCallback('raw=query')).rejects.toThrow(
      BadRequestException,
    );
    expect(grant).not.toHaveBeenCalled();
  });

  it('rejects an ad unit outside the configured allow-list', async () => {
    const { service, grant } = makeService({
      reward: rewardFixture({ adUnit: 'unexpected-unit' }),
      allowedAdUnits: ['allowed-unit'],
    });

    await expect(service.processAdCallback('raw=query')).rejects.toThrow(
      BadRequestException,
    );
    expect(grant).not.toHaveBeenCalled();
  });
});
