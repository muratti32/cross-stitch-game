import { BadRequestException } from '@nestjs/common';

import type { AppConfigService } from '../config/app-config.service';
import type {
  AdMobSsvReward,
  AdMobSsvVerifierService,
} from './admob-ssv-verifier.service';
import type {
  AdRewardGrantResult,
  CoinLedgerRepository,
} from './coin-ledger.repository';
import { RewardGrantService } from './reward-grant.service';
import { utcRewardDay } from './reward-day';

const GUEST_ID = '11111111-1111-4111-8111-111111111111';

function rewardFixture(overrides: Partial<AdMobSsvReward> = {}): AdMobSsvReward {
  return {
    transactionId: 'txn-1',
    customData: `guest:${GUEST_ID}`,
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
}): { service: RewardGrantService; grant: jest.Mock } {
  const verifier = {
    verify: jest.fn().mockResolvedValue(options.reward),
  } as unknown as AdMobSsvVerifierService;
  const grant = options.grant ?? jest.fn().mockResolvedValue(grantResult());
  const ledger = {
    grantAdReward: grant,
  } as unknown as CoinLedgerRepository;
  const config = {
    admobSsvAllowedAdUnits: options.allowedAdUnits ?? [],
  } as unknown as AppConfigService;
  return {
    service: new RewardGrantService(verifier, ledger, config),
    grant,
  };
}

describe('RewardGrantService', () => {
  it('grants a verified guest callback idempotently by transaction id', async () => {
    const { service, grant } = makeService({ reward: rewardFixture() });

    const result = await service.processAdCallback('raw=query');

    expect(grant).toHaveBeenCalledWith(
      { type: 'guest', id: GUEST_ID },
      utcRewardDay(),
      'ad:txn-1',
    );
    expect(result.granted).toBe(true);
    expect(result.transactionId).toBe('txn-1');
  });

  it('resolves an account principal from custom data', async () => {
    const accountId = '22222222-2222-4222-8222-222222222222';
    const { service, grant } = makeService({
      reward: rewardFixture({ customData: `account:${accountId}` }),
    });

    await service.processAdCallback('raw=query');

    expect(grant).toHaveBeenCalledWith(
      { type: 'account', id: accountId },
      expect.any(String),
      'ad:txn-1',
    );
  });

  it('rejects malformed custom data without granting', async () => {
    const { service, grant } = makeService({
      reward: rewardFixture({ customData: 'not-a-principal' }),
    });

    await expect(service.processAdCallback('raw=query')).rejects.toThrow(
      BadRequestException,
    );
    expect(grant).not.toHaveBeenCalled();
  });

  it('rejects an unknown principal type', async () => {
    const { service, grant } = makeService({
      reward: rewardFixture({ customData: `operator:${GUEST_ID}` }),
    });

    await expect(service.processAdCallback('raw=query')).rejects.toThrow(
      BadRequestException,
    );
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
