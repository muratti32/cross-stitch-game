import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { createAdRewardLedgerFake } from '../../test/fakes/ad-reward-ledger.fake';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import type { AppConfigService } from '../config/app-config.service';
import { AdAttemptService } from './ad-attempt.service';
import { AdAttemptRepository } from './ad-attempt.repository';
import { CoinLedgerRepository } from './coin-ledger.repository';

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
    enableAdmobSsv?: boolean;
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
      findOwned: jest.fn(),
    } as unknown as AdAttemptRepository;

    const config = {
      adAttemptTtlSeconds: options.ttlSeconds ?? 300,
      enableAdmobSsv: options.enableAdmobSsv ?? false,
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
      ssvActive: false,
    });
    expect(adAttempts.create).toHaveBeenCalledWith(
      { type: 'guest', id: 'guest-uuid-1' },
      'rewarded_ad',
      300,
    );
  });

  it('opens an attempt with ssvActive: true when SSV is enabled', async () => {
    const { service } = makeService({
      adsCompleted: 0,
      coinsConsumed: 0,
      enableAdmobSsv: true,
    });

    const result = await service.openAttempt(principal);
    expect(result.ssvActive).toBe(true);
  });

  it.each([
    [{ consumedAt: new Date('2026-07-23T11:59:00Z'), expiresAt: new Date('2026-07-23T12:00:00Z') }, 'verified'],
    [{ consumedAt: null, expiresAt: new Date('2999-07-23T12:00:00Z') }, 'pending'],
    [{ consumedAt: null, expiresAt: new Date('2000-07-23T12:00:00Z') }, 'expired'],
  ] as const)('returns owner-scoped attempt state %s', async (attempt, state) => {
    const { service, adAttempts } = makeService({ adsCompleted: 0, coinsConsumed: 0 });
    jest.mocked(adAttempts.findOwned).mockResolvedValue(attempt);
    await expect(service.getAttemptState(principal, 'nonce')).resolves.toEqual({
      state,
      expiresAt: attempt.expiresAt.toISOString(),
    });
    expect(adAttempts.findOwned).toHaveBeenCalledWith(
      { type: 'guest', id: 'guest-uuid-1' },
      'nonce',
    );
  });

  it('hides missing or foreign attempts behind 404', async () => {
    const { service, adAttempts } = makeService({ adsCompleted: 0, coinsConsumed: 0 });
    jest.mocked(adAttempts.findOwned).mockResolvedValue(null);
    await expect(service.getAttemptState(principal, 'nonce')).rejects.toThrow(NotFoundException);
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

  it('returns current balance and status idempotently when claiming client reward with SSV enabled', async () => {
    const status = { adsCompleted: 1, coinsConsumed: 10, premiumClaimed: false };
    const ledger = {
      getBalance: jest.fn().mockResolvedValue(50),
      getRewardDayStatus: jest.fn().mockResolvedValue(status),
    } as unknown as CoinLedgerRepository;
    const adAttempts = {
      consume: jest.fn(),
    } as unknown as AdAttemptRepository;
    const config = {
      enableAdmobSsv: true,
    } as unknown as AppConfigService;

    const service = new AdAttemptService(adAttempts, ledger, config);

    const result = await service.claimClientReward(principal, 'nonce-123');
    expect(result).toEqual({
      granted: false,
      amount: 0,
      balance: 50,
      adsCompleted: 1,
      coinsConsumed: 10,
      replayed: false,
    });
    expect(adAttempts.consume).not.toHaveBeenCalled();
  });

  it('claims client reward successfully when SSV is disabled', async () => {
    const ledger = {
      findExistingAdGrant: jest.fn().mockResolvedValue(null),
      grantAdReward: jest.fn().mockResolvedValue({
        granted: true,
        amount: 10,
        balance: 10,
        adsCompleted: 1,
        coinsConsumed: 10,
        replayed: false,
      }),
    } as unknown as CoinLedgerRepository;

    const adAttempts = {
      consume: jest.fn().mockResolvedValue({ type: 'guest', id: 'guest-uuid-1' }),
    } as unknown as AdAttemptRepository;

    const config = {
      enableAdmobSsv: false,
    } as unknown as AppConfigService;

    const service = new AdAttemptService(adAttempts, ledger, config);

    const result = await service.claimClientReward(principal, 'nonce-123');

    expect(result).toEqual({
      granted: true,
      amount: 10,
      balance: 10,
      adsCompleted: 1,
      coinsConsumed: 10,
      replayed: false,
    });
    expect(adAttempts.consume).toHaveBeenCalledWith('nonce-123');
    expect(ledger.grantAdReward).toHaveBeenCalledWith(
      { type: 'guest', id: 'guest-uuid-1' },
      expect.any(String),
      'ad_client:nonce-123',
    );
  });
  describe('client claim after a Guest Economy Promotion', () => {
    const GUEST_ID = '11111111-1111-4111-8111-111111111111';
    const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
    const guest = { type: 'guest', id: GUEST_ID } as const;
    const account = { type: 'account', id: ACCOUNT_ID } as const;
    const asPrincipal = (type: PrincipalType, id: string): AuthPrincipal => ({ type, id, tokenVersion: 1 });

    function promotedGuestWithPendingAd(mode: 'economy' | 'data-only' = 'economy') {
      const fake = createAdRewardLedgerFake();
      fake.openAttempt('nonce-1', guest);
      fake.commitPromotion(GUEST_ID, ACCOUNT_ID, mode);
      const config = { enableAdmobSsv: false } as unknown as AppConfigService;
      const service = new AdAttemptService(
        new AdAttemptRepository(fake.dataSource),
        new CoinLedgerRepository(fake.dataSource),
        config,
      );
      return { fake, service };
    }

    it('lets the target account claim the Guest nonce and pays the account', async () => {
      const { fake, service } = promotedGuestWithPendingAd();

      await expect(service.claimClientReward(asPrincipal(PrincipalType.Account, ACCOUNT_ID), 'nonce-1')).resolves.toMatchObject({
        granted: true,
        amount: 10,
        balance: 10,
        replayed: false,
      });
      expect(fake.balanceOf(account)).toBe(10);
      expect(fake.balanceOf(guest)).toBe(0);
      expect(fake.entryFor('ad_client:nonce-1')).toMatchObject({ principal_type: 'account', principal_id: ACCOUNT_ID });
    });

    it('pays the account when the Guest token claims after promotion', async () => {
      const { fake, service } = promotedGuestWithPendingAd();
      await service.claimClientReward(asPrincipal(PrincipalType.Guest, GUEST_ID), 'nonce-1');
      expect(fake.balanceOf(account)).toBe(10);
      expect(fake.balanceOf(guest)).toBe(0);
    });

    it('replays a second claim of the same nonce against the account', async () => {
      const { fake, service } = promotedGuestWithPendingAd();
      await service.claimClientReward(asPrincipal(PrincipalType.Account, ACCOUNT_ID), 'nonce-1');

      await expect(service.claimClientReward(asPrincipal(PrincipalType.Account, ACCOUNT_ID), 'nonce-1')).resolves.toMatchObject({
        granted: true,
        balance: 10,
        replayed: true,
      });
      expect(fake.balanceOf(account)).toBe(10);
    });

    it('rejects an unrelated account', async () => {
      const { fake, service } = promotedGuestWithPendingAd();
      await expect(
        service.claimClientReward(asPrincipal(PrincipalType.Account, '33333333-3333-4333-8333-333333333333'), 'nonce-1'),
      ).rejects.toThrow(BadRequestException);
      expect(fake.balanceOf(account)).toBe(0);
      expect(fake.entryFor('ad_client:nonce-1')).toBeUndefined();
    });

    it('rejects the target account after a data-only promotion', async () => {
      const { service } = promotedGuestWithPendingAd('data-only');
      await expect(service.claimClientReward(asPrincipal(PrincipalType.Account, ACCOUNT_ID), 'nonce-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
