import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { RegisterBundledSessionDto } from './progress-sync.dto';

const patternId = 'dc47c329-35fd-4173-9ad9-5098369beb44';

function errors(body: object): string[] {
  return validateSync(plainToInstance(RegisterBundledSessionDto, body)).map((error) => error.property);
}

describe('RegisterBundledSessionDto', () => {
  it('accepts a Guest identity request with no bitmap', () => {
    expect(errors({ patternId, localState: 'in_progress' })).toEqual([]);
  });

  it('accepts an account request with a bitmap and a completion time', () => {
    expect(
      errors({
        patternId,
        localState: 'completed',
        completedAt: '2026-11-01T12:00:00.000Z',
        packedBitmapBase64: Buffer.alloc(50, 255).toString('base64'),
      }),
    ).toEqual([]);
  });

  it.each([
    ['a non-uuid pattern', { patternId: 'starter_heart', localState: 'in_progress' }, 'patternId'],
    ['an unknown local state', { patternId, localState: 'preparing' }, 'localState'],
    ['a calendar-invalid time', { patternId, localState: 'completed', completedAt: '2026-02-30T00:00:00Z' }, 'completedAt'],
    ['a non-base64 bitmap', { patternId, localState: 'completed', packedBitmapBase64: 'not base64!' }, 'packedBitmapBase64'],
    ['an oversized bitmap', { patternId, localState: 'completed', packedBitmapBase64: 'AAAA'.repeat(65) }, 'packedBitmapBase64'],
  ])('rejects %s', (_label, body, property) => {
    expect(errors(body)).toEqual([property]);
  });
});
