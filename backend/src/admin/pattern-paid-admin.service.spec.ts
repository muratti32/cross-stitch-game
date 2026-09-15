import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { PatternEntity } from '../catalog/entities';
import { OfficialPatternDraftEntity } from './entities';
import { PatternPaidAdminService } from './pattern-paid-admin.service';

function pattern(overrides: Partial<PatternEntity> = {}): PatternEntity {
  return Object.assign(new PatternEntity(), {
    id: '00000000-0000-4000-8000-000000000001',
    creatorProfileId: null,
    visibility: 'catalog',
    status: 'available',
    unlockPriceTier: null,
    ...overrides,
  });
}

function harness(entity: PatternEntity | null, stitchableCellCount = 4_000) {
  const save = jest.fn((value: PatternEntity) => Promise.resolve(value));
  const query = jest.fn().mockResolvedValue([]);
  const findPattern = jest.fn().mockResolvedValue(entity);
  const findDraft = jest.fn().mockResolvedValue(
    Object.assign(new OfficialPatternDraftEntity(), { stitchableCellCount }),
  );
  const manager = {
    getRepository: jest.fn((target: typeof PatternEntity | typeof OfficialPatternDraftEntity) =>
      target === PatternEntity
        ? { findOne: findPattern, save }
        : { findOne: findDraft },
    ),
    query,
  };
  const dataSource = {
    transaction: jest.fn(
      (callback: (value: typeof manager) => Promise<unknown>) => callback(manager),
    ),
  };
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new PatternPaidAdminService(
    dataSource as never,
    auditLog,
  );
  return {
    auditLog,
    dataSource,
    findDraft,
    manager,
    query,
    save,
    service,
  };
}

describe('PatternPaidAdminService', () => {
  it('grandfathers session principals and audits free to paid', async () => {
    const entity = pattern();
    const fixture = harness(entity);
    fixture.query.mockResolvedValueOnce([
      { principalId: '00000000-0000-4000-8000-000000000010' },
      { principalId: '00000000-0000-4000-8000-000000000011' },
    ]);

    await expect(
      fixture.service.setPatternPaid('operator', entity.id, true, 'request'),
    ).resolves.toEqual({
      patternId: entity.id,
      changed: true,
      beforeTier: null,
      afterTier: 'medium',
      grandfatheredCount: 2,
    });
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT DISTINCT"),
      [entity.id],
    );
    expect(fixture.auditLog.record).toHaveBeenCalledWith(
      fixture.manager,
      expect.objectContaining({
        action: 'pattern.paid_change',
        after: {
          unlockPriceTier: 'medium',
          paid: true,
          grandfatheredCount: 2,
        },
      }),
    );
  });

  it('does no writes or audit for an unchanged request', async () => {
    const entity = pattern({ unlockPriceTier: 'medium' });
    const fixture = harness(entity);

    await expect(
      fixture.service.setPatternPaid('operator', entity.id, true, null),
    ).resolves.toMatchObject({ changed: false, grandfatheredCount: 0 });
    expect(fixture.query).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.auditLog.record).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown Pattern', async () => {
    const fixture = harness(null);

    await expect(
      fixture.service.setPatternPaid(
        'operator',
        '00000000-0000-4000-8000-000000000099',
        true,
        null,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it.each([
    { creatorProfileId: '00000000-0000-4000-8000-000000000002' },
    { visibility: 'personal' as const },
    { status: 'removed' as const },
  ])('rejects an ineligible Pattern', async (override) => {
    const entity = pattern(override);
    const fixture = harness(entity);

    const error = await fixture.service
      .setPatternPaid('operator', entity.id, true, null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'pattern_not_eligible',
    });
  });

  it('rejects paid when the publishing draft has no stitchable count', async () => {
    const entity = pattern();
    const fixture = harness(entity);
    fixture.findDraft.mockResolvedValueOnce(null);

    const error = await fixture.service
      .setPatternPaid('operator', entity.id, true, null)
      .catch((caught: unknown) => caught);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'stitchable_cell_count_unknown',
    });
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it('rejects paid when the publishing draft has a non-positive stitchable count', async () => {
    const entity = pattern();
    const fixture = harness(entity, 0);

    const error = await fixture.service
      .setPatternPaid('operator', entity.id, true, null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'stitchable_cell_count_unknown',
    });
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it('makes paid free without deleting unlocks and audits the change', async () => {
    const entity = pattern({ unlockPriceTier: 'small' });
    const fixture = harness(entity);

    await expect(
      fixture.service.setPatternPaid('operator', entity.id, false, null),
    ).resolves.toMatchObject({
      changed: true,
      beforeTier: 'small',
      afterTier: null,
      grandfatheredCount: 0,
    });
    expect(fixture.findDraft).not.toHaveBeenCalled();
    expect(fixture.query).not.toHaveBeenCalled();
    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(fixture.auditLog.record).toHaveBeenCalledTimes(1);
  });

  it('reports a failed bulk item without aborting later Patterns', async () => {
    const service = new PatternPaidAdminService({} as never, {} as never);
    const setPatternPaid = jest
      .spyOn(service, 'setPatternPaid')
      .mockRejectedValueOnce(
        new ConflictException({ code: 'pattern_not_eligible' }),
      )
      .mockResolvedValueOnce({
        patternId: 'b',
        changed: true,
        beforeTier: null,
        afterTier: 'small',
        grandfatheredCount: 1,
      });

    await expect(
      service.setPatternsPaid('operator', ['b', 'a'], true, null),
    ).resolves.toEqual({
      paid: true,
      results: [
        {
          patternId: 'a',
          outcome: 'failed',
          errorCode: 'pattern_not_eligible',
        },
        {
          patternId: 'b',
          outcome: 'changed',
          beforeTier: null,
          afterTier: 'small',
          grandfatheredCount: 1,
        },
      ],
    });
    expect(setPatternPaid.mock.calls.map((call) => call[1])).toEqual(['a', 'b']);
  });

  it('rejects case-insensitive duplicate bulk Pattern IDs', async () => {
    const service = new PatternPaidAdminService({} as never, {} as never);
    const setPatternPaid = jest.spyOn(service, 'setPatternPaid');

    await expect(
      service.setPatternsPaid(
        'operator',
        ['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAA1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'],
        true,
        null,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(setPatternPaid).not.toHaveBeenCalled();
  });
});
