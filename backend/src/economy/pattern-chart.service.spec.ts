import { ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { InsufficientCoinError } from './coin-ledger.repository';
import { PatternChartService } from './pattern-chart.service';

const accountId = '11111111-1111-4111-8111-111111111111';
const patternId = '44444444-4444-4444-8444-444444444444';
const account: AuthPrincipal = { id: accountId, type: PrincipalType.Account, tokenVersion: 1 };
const guest: AuthPrincipal = { id: accountId, type: PrincipalType.Guest, tokenVersion: 1 };

function pattern(overrides: Record<string, unknown> = {}) {
  return {
    id: patternId,
    visibility: 'catalog',
    creatorProfileId: null,
    status: 'available',
    width: 50,
    height: 50,
    stitchableCellCount: 2_000,
    unlockPriceTier: null,
    artifactByteLength: 321,
    artifactChecksum: 'abc  ',
    artifactSchemaVersion: 1,
    ...overrides,
  };
}

function harness(found: Record<string, unknown> | null = pattern()) {
  const repository = {
    isEntitled: jest.fn().mockResolvedValue(false),
    listPatternIds: jest.fn().mockResolvedValue([patternId]),
    isPatternUnlocked: jest.fn().mockResolvedValue(false),
    spend: jest.fn().mockResolvedValue({ alreadyEntitled: false, price: 20, balance: 30 }),
  };
  const patternRepo = { findOne: jest.fn().mockResolvedValue(found) };
  const promotionService = { assertNotLocked: jest.fn().mockResolvedValue(undefined) };
  const configService = { grantSigningSecret: 'secret', grantTtlSeconds: 300 };
  const service = new PatternChartService(
    repository as never,
    patternRepo as never,
    promotionService as never,
    configService as never,
  );
  return { service, repository, promotionService };
}

async function codeOf(promise: Promise<unknown>): Promise<{ type: unknown; response: unknown }> {
  try {
    await promise;
  } catch (error) {
    return { type: (error as object).constructor, response: (error as { getResponse(): unknown }).getResponse() };
  }
  throw new Error('expected rejection');
}

describe('PatternChartService', () => {
  describe('guests', () => {
    it.each([
      ['listEntitlements', (s: PatternChartService) => s.listEntitlements(guest)],
      ['view', (s: PatternChartService) => s.view(guest, patternId)],
      ['purchase', (s: PatternChartService) => s.purchase(guest, patternId, 20)],
      ['artifactGrant', (s: PatternChartService) => s.artifactGrant(guest, patternId)],
    ])('refuses %s with account_required and no spend', async (_name, call) => {
      const { service, repository } = harness();

      const error = await codeOf(call(service));

      expect(error.type).toBe(ForbiddenException);
      expect(error.response).toMatchObject({ code: 'account_required' });
      expect(repository.spend).not.toHaveBeenCalled();
    });
  });

  describe('purchase', () => {
    it('spends the server price for an Official free Pattern', async () => {
      const { service, repository, promotionService } = harness();

      await expect(service.purchase(account, patternId, 20)).resolves.toEqual({
        patternId,
        alreadyEntitled: false,
        price: 20,
        balance: 30,
      });
      expect(promotionService.assertNotLocked).toHaveBeenCalledWith(accountId, PrincipalType.Account);
      expect(repository.spend).toHaveBeenCalledWith(accountId, patternId, 20, 'small');
    });

    it('prices by stitchable cells, not the unlock price tier', async () => {
      const { service, repository } = harness(pattern({ stitchableCellCount: 15_000, unlockPriceTier: 'small' }));
      repository.isPatternUnlocked.mockResolvedValue(true);

      await service.purchase(account, patternId, 60);

      expect(repository.spend).toHaveBeenCalledWith(accountId, patternId, 60, 'large');
    });

    it('falls back to width x height when the stitchable count is missing', async () => {
      const { service, repository } = harness(pattern({ stitchableCellCount: null, width: 100, height: 50 }));

      await service.purchase(account, patternId, 40);

      expect(repository.spend).toHaveBeenCalledWith(accountId, patternId, 40, 'medium');
    });

    it.each([
      ['Community', { creatorProfileId: 'cp' }],
      ['Personal', { visibility: 'personal' }],
    ])('returns 404 for a %s Pattern', async (_name, overrides) => {
      const { service, repository } = harness(pattern(overrides));

      expect((await codeOf(service.purchase(account, patternId, 20))).type).toBe(NotFoundException);
      expect(repository.spend).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown Pattern', async () => {
      const { service } = harness(null);

      expect((await codeOf(service.purchase(account, patternId, 20))).type).toBe(NotFoundException);
    });

    it.each([
      ['withdrawn', 'pattern_unavailable'],
      ['review_hold', 'pattern_unavailable'],
      ['removed', 'pattern_removed'],
    ])('refuses a %s Pattern with %s', async (status, code) => {
      const { service, repository } = harness(pattern({ status }));

      const error = await codeOf(service.purchase(account, patternId, 20));

      expect(error.type).toBe(GoneException);
      expect(error.response).toMatchObject({ code });
      expect(repository.spend).not.toHaveBeenCalled();
    });

    it('requires the Pattern Unlock for a paid Pattern the player cannot start', async () => {
      const { service, repository } = harness(pattern({ unlockPriceTier: 'medium' }));

      const error = await codeOf(service.purchase(account, patternId, 20));

      expect(error.type).toBe(ForbiddenException);
      expect(error.response).toMatchObject({ code: 'unlock_required', patternId, price: 150 });
      expect(repository.spend).not.toHaveBeenCalled();
    });

    it('allows a paid Pattern the account has unlocked', async () => {
      const { service, repository } = harness(pattern({ unlockPriceTier: 'medium' }));
      repository.isPatternUnlocked.mockResolvedValue(true);

      await expect(service.purchase(account, patternId, 20)).resolves.toMatchObject({ alreadyEntitled: false });
    });

    it('rejects a stale expectedPrice with the current price and no charge', async () => {
      const { service, repository } = harness();

      const error = await codeOf(service.purchase(account, patternId, 40));

      expect(error.type).toBe(ConflictException);
      expect(error.response).toMatchObject({ code: 'pattern_chart_price_changed', price: 20 });
      expect(repository.spend).not.toHaveBeenCalled();
    });

    it('returns alreadyEntitled without a price check or charge', async () => {
      const { service, repository } = harness();
      repository.isEntitled.mockResolvedValue(true);
      repository.spend.mockResolvedValue({ alreadyEntitled: true, price: 20, balance: 5 });

      await expect(service.purchase(account, patternId, 999)).resolves.toEqual({
        patternId,
        alreadyEntitled: true,
        price: 20,
        balance: 5,
      });
    });

    it('maps an insufficient or negative balance to 409 insufficient_balance', async () => {
      const { service, repository } = harness();
      repository.spend.mockRejectedValue(new InsufficientCoinError(20, -3));

      const error = await codeOf(service.purchase(account, patternId, 20));

      expect(error.type).toBe(ConflictException);
      expect(error.response).toMatchObject({ code: 'insufficient_balance', price: 20, balance: -3 });
    });

    it('rethrows unexpected failures', async () => {
      const { service, repository } = harness();
      repository.spend.mockRejectedValue(new Error('db down'));

      await expect(service.purchase(account, patternId, 20)).rejects.toThrow('db down');
    });

    it('honours the promotion lock before any read', async () => {
      const { service, repository, promotionService } = harness();
      promotionService.assertNotLocked.mockRejectedValue(new ConflictException({ code: 'promotion_locked' }));

      await expect(service.purchase(account, patternId, 20)).rejects.toBeInstanceOf(ConflictException);
      expect(repository.spend).not.toHaveBeenCalled();
    });
  });

  describe('listEntitlements and view', () => {
    it('lists the account entitlement pattern ids', async () => {
      const { service, repository } = harness();

      await expect(service.listEntitlements(account)).resolves.toEqual({ patternIds: [patternId] });
      expect(repository.listPatternIds).toHaveBeenCalledWith(accountId);
    });

    it('reports the server price and entitlement state', async () => {
      const { service, repository } = harness(pattern({ stitchableCellCount: 4_000 }));
      repository.isEntitled.mockResolvedValue(true);

      await expect(service.view(account, patternId)).resolves.toEqual({ patternId, entitled: true, price: 40 });
    });
  });

  describe('artifactGrant', () => {
    it('issues a signed grant without creating a session', async () => {
      const { service, repository } = harness();
      repository.isEntitled.mockResolvedValue(true);

      const grant = await service.artifactGrant(account, patternId);

      expect(grant).toMatchObject({
        patternId,
        artifact: { byteLength: 321, checksum: 'abc', schemaVersion: 1 },
      });
      expect(grant.grant.url).toMatch(new RegExp(`^/v1/artifacts/${patternId}\\?exp=\\d+&sig=[0-9a-f]{64}$`));
      expect(grant).not.toHaveProperty('sessionId');
    });

    it('refuses an account without the entitlement', async () => {
      const { service } = harness();

      const error = await codeOf(service.artifactGrant(account, patternId));

      expect(error.type).toBe(ForbiddenException);
      expect(error.response).toMatchObject({ code: 'pattern_chart_required' });
    });

    it.each([
      ['withdrawn', 'pattern_unavailable'],
      ['removed', 'pattern_removed'],
    ])('stops new fetches for a %s Pattern even when entitled', async (status, code) => {
      const { service, repository } = harness(pattern({ status }));
      repository.isEntitled.mockResolvedValue(true);

      const error = await codeOf(service.artifactGrant(account, patternId));

      expect(error.type).toBe(GoneException);
      expect(error.response).toMatchObject({ code });
    });

    it('returns 404 for a non-Official Pattern', async () => {
      const { service } = harness(pattern({ creatorProfileId: 'cp' }));

      expect((await codeOf(service.artifactGrant(account, patternId))).type).toBe(NotFoundException);
    });
  });
});
