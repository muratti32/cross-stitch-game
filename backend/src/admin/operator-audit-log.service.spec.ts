import { EntityManager } from 'typeorm';

import { OperatorAuditLogEntity } from './entities';
import { OperatorAuditLogService, redactAuditValue } from './operator-audit-log.service';

describe('redactAuditValue', () => {
  it('redacts keys that look like credentials, secrets, or hashes at any depth', () => {
    const redacted = redactAuditValue({
      title: 'Autumn Leaf',
      operator: {
        passwordHash: 'not-a-real-hash',
        totpSecretEncrypted: 'iv.tag.ciphertext',
      },
      recoveryCodes: ['AAAAA-BBBBB'],
    });

    expect(redacted).toEqual({
      title: 'Autumn Leaf',
      operator: {
        passwordHash: '[redacted]',
        totpSecretEncrypted: '[redacted]',
      },
      recoveryCodes: '[redacted]',
    });
  });

  it('redacts raw image/artifact byte payloads instead of inlining them', () => {
    // Uses a key that does NOT itself match the sensitive-key pattern, so
    // this isolates the Buffer-content redaction path from key-name redaction.
    const redacted = redactAuditValue({
      checksum: 'abc123',
      sourceUpload: Buffer.from('binary pattern artifact'),
    });

    expect(redacted).toEqual({
      checksum: 'abc123',
      sourceUpload: '[redacted:23-bytes]',
    });
  });

  it('redacts a key that looks like raw bytes even without inspecting its content', () => {
    const redacted = redactAuditValue({
      artifactBytes: Buffer.from('binary pattern artifact'),
      checksum: 'abc123',
    });

    expect(redacted).toEqual({
      artifactBytes: '[redacted]',
      checksum: 'abc123',
    });
  });

  it('leaves ordinary metadata untouched', () => {
    expect(
      redactAuditValue({ status: 'available', tagCodes: ['retro', 'cute'] }),
    ).toEqual({ status: 'available', tagCodes: ['retro', 'cute'] });
  });

  it('passes null through as null', () => {
    expect(redactAuditValue(null)).toBeNull();
  });
});

describe('OperatorAuditLogService', () => {
  it('writes through the caller-supplied manager so the row commits with the caller transaction', async () => {
    const save = jest
      .fn<Promise<OperatorAuditLogEntity>, [OperatorAuditLogEntity]>()
      .mockResolvedValue({} as OperatorAuditLogEntity);
    const create = jest.fn(
      (value: Partial<OperatorAuditLogEntity>) => value as OperatorAuditLogEntity,
    );
    const manager = {
      getRepository: () => ({ create, save }),
    } as unknown as EntityManager;
    const service = new OperatorAuditLogService();

    await service.record(manager, {
      action: 'pattern.publish',
      after: { title: 'Autumn Leaf', passwordHash: 'nope' },
      before: null,
      operatorAccountId: '11111111-1111-4111-8111-111111111111',
      outcome: 'success',
      targetId: '22222222-2222-4222-8222-222222222222',
      targetType: 'pattern',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'pattern.publish',
        after: { title: 'Autumn Leaf', passwordHash: '[redacted]' },
        before: null,
        operatorAccountId: '11111111-1111-4111-8111-111111111111',
        outcome: 'success',
      }),
    );
    expect(save).toHaveBeenCalledTimes(1);
  });
});
