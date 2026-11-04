import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PromotionCommitRequestDto } from './promotion-commit.dto';

const pipeOptions = { whitelist: true, forbidNonWhitelisted: true };

function previewResponse(overrides: Record<string, unknown> = {}) {
  return {
    guestId: '11111111-1111-4111-8111-111111111111',
    accountId: '22222222-2222-4222-8222-222222222222',
    promotionMode: 'economy',
    manifestChecksum: 'checksum',
    guestLedgerBalance: 40,
    guestUnlockCount: 2,
    pendingAdAttemptCount: 1,
    validatedPendingRewards: ['daily_task:guest:x:2026-01-01:cells_100'],
    rejectedPendingRewards: {},
    dispositions: { coinBalance: 'transfer', pendingRewards: 'validate', progress: 'transfer', completions: 'transfer', likes: 'transfer' },
    expiry: '2026-11-04T12:00:00.000Z',
    signature: 'sig',
    paidCommerce: 'none',
    ...overrides,
  };
}

async function errorsFor(previewData: Record<string, unknown>) {
  const dto = plainToInstance(PromotionCommitRequestDto, { previewData, signature: 'sig' });
  return validate(dto, pipeOptions);
}

describe('PromotionCommitRequestDto', () => {
  it('accepts the full preview response the client echoes back', async () => {
    await expect(errorsFor(previewResponse())).resolves.toEqual([]);
  });

  it('rejects an unknown promotion mode', async () => {
    const errors = await errorsFor(previewResponse({ promotionMode: 'both' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('previewData');
  });

  it('rejects a preview with fields the server never issues', async () => {
    const errors = await errorsFor(previewResponse({ bonusCoin: 500 }));
    expect(errors).toHaveLength(1);
  });

  it('rejects a preview missing a signed field', async () => {
    const { guestLedgerBalance: _omitted, ...withoutBalance } = previewResponse();
    const errors = await errorsFor(withoutBalance);
    expect(errors).toHaveLength(1);
  });
});
