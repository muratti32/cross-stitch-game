import { ConflictException } from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import type { AppConfigService } from '../config/app-config.service';
import { AdAttemptService } from './ad-attempt.service';
import type { AdAttemptRepository } from './ad-attempt.repository';
import type { CoinLedgerRepository } from './coin-ledger.repository';

describe('AdAttemptService', () => {
  const principal: AuthPrincipal = {
    type: PrincipalType.Guest,
    id: 'guest-uuid-1',
    tokenVersion: 1,
  };


  function makeService(options: {
    adsCompleted: number;
    coinsConsumed: number;
    premiumClaimed?: boolean;
    createResult?: { nonce: string; expiresAt: Date };
    ttlSeconds?: number;
  }) {
    const status = {
      adsCompleted: options.adsCompleted,
      coinsConsumed: options.coinsConsumed,
      premiumClaimed: options.premiumClaimed ?? false,
    };
    const ledger = {
      getRewardDayStatus: jest.fn().mockResolvedValue(status),
    } as unknown as CoinLedgerRepository;

    const createResult = options.createResult ?? {
      nonce: 'nonce-uuid-123',
      expiresAt: new Date('2026-07-23T12:00:00.000Z'),
    };
    const adAttempts = {
      create: jest.fn().mockResolvedValue(createResult),
    } as unknown as AdAttemptRepository;

    const config = {
      adAttemptTtlSeconds: options.ttlSeconds ?? 300,
    } as unknown as AppConfigService;

    const service = new AdAttemptService(adAttempts, ledger, config);

    return { service, ledger, adAttempts };
  }

  it('opens an attempt when pool has room', async () => {
    const { service, adAttempts } = makeService({
      adsCompleted: 1,
      coinsConsumed: 10,
    });

    const result = await service.openAttempt(principal);

    expect(result).toEqual({
      nonce: 'nonce-uuid-123',
      expiresAt: '2026-07-23T12:00:00.000Z',
    });
    expect(adAttempts.create).toHaveBeenCalledWith(
      { type: 'guest', id: 'guest-uuid-1' },
      'rewarded_ad',
      300,
    );
  });

  it('throws ConflictException when adsCompleted >= DAILY_AD_LIMIT', async () => {
    const { service, adAttempts } = makeService({
      adsCompleted: 3,
      coinsConsumed: 30,
    });

    await expect(service.openAttempt(principal)).rejects.toThrow(
      ConflictException,
    );
    expect(adAttempts.create).not.toHaveBeenCalled();
  });

  it('throws ConflictException when remaining pool coins < AD_REWARD_COIN', async () => {
    const { service, adAttempts } = makeService({
      adsCompleted: 2,
      coinsConsumed: 25,
    });

    await expect(service.openAttempt(principal)).rejects.toThrow(
      ConflictException,
    );
    expect(adAttempts.create).not.toHaveBeenCalled();
  });

  it('throws ConflictException after Premium Daily Coin Claim closes the pool', async () => {
    const { service, adAttempts } = makeService({
      adsCompleted: 0,
      coinsConsumed: 30,
      premiumClaimed: true,
    });

    await expect(service.openAttempt(principal)).rejects.toThrow(ConflictException);
    expect(adAttempts.create).not.toHaveBeenCalled();
  });
});
