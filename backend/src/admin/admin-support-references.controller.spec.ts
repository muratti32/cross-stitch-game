import { DataSource, EntityManager } from 'typeorm';

import type { ResolvedSupportReference } from '../support/support-reference.service';
import { SupportReferenceService } from '../support/support-reference.service';
import { AdminSupportReferencesController } from './admin-support-references.controller';
import { OperatorRole } from './entities';
import {
  OperatorAuditLogService,
  RecordAuditLogInput,
} from './operator-audit-log.service';

const OPERATOR = {
  id: '11111111-1111-4111-8111-111111111111',
  role: OperatorRole.Owner,
};

function buildController(resolved: ResolvedSupportReference | null) {
  const manager = {} as EntityManager;
  const dataSource = {
    transaction: async <T>(work: (entityManager: EntityManager) => Promise<T>) => work(manager),
  } as unknown as DataSource;
  const supportReferences = {
    resolve: jest.fn().mockResolvedValue(resolved),
  } as unknown as SupportReferenceService;
  const record = jest
    .fn<Promise<void>, [EntityManager, RecordAuditLogInput]>()
    .mockResolvedValue(undefined);
  const auditLog = { record } as unknown as OperatorAuditLogService;

  return {
    controller: new AdminSupportReferencesController(dataSource, supportReferences, auditLog),
    record,
  };
}

describe('AdminSupportReferencesController', () => {
  it('returns the resolved owned records and audits the operator reason', async () => {
    const resolved: ResolvedSupportReference = {
      code: 'SW-ABCD-EFGH-JKMN',
      createdAt: '2026-07-23T12:00:00.000Z',
      id: '22222222-2222-4222-8222-222222222222',
      principal: { id: '33333333-3333-4333-8333-333333333333', type: 'account' },
      records: [{ data: { status: 'failed' }, id: '44444444-4444-4444-8444-444444444444', type: 'processing_job' }],
    };
    const { controller, record } = buildController(resolved);

    await expect(
      controller.lookup(
        OPERATOR,
        { code: resolved.code, reason: 'Investigating player conversion failure' },
        'request-1',
      ),
    ).resolves.toBe(resolved);
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'support_reference.lookup',
        operatorAccountId: OPERATOR.id,
        outcome: 'success',
        targetId: resolved.id,
      }),
    );
    expect(record.mock.calls[0]?.[1].after).toEqual(
      expect.objectContaining({ reason: 'Investigating player conversion failure' }),
    );
  });

  it('fails closed for an unknown code and still audits the attempt', async () => {
    const { controller, record } = buildController(null);

    await expect(
      controller.lookup(
        OPERATOR,
        { code: 'SW-ABCD-EFGH-JKMN', reason: 'Investigating reported failed sync' },
      ),
    ).rejects.toThrow('Support Reference not found');
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: 'failure', operatorAccountId: OPERATOR.id }),
    );
  });
});
