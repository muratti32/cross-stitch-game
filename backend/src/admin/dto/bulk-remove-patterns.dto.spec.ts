import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BulkRemovePatternsDto } from './bulk-remove-patterns.dto';

const ID = '00000000-0000-4000-8000-000000000001';
const BATCH_ID = '00000000-0000-4000-8000-000000000099';

async function errors(input: object) {
  return validate(plainToInstance(BulkRemovePatternsDto, input));
}

describe('BulkRemovePatternsDto', () => {
  it('trims a valid reason at the API boundary', async () => {
    const dto = plainToInstance(BulkRemovePatternsDto, {
      batchId: BATCH_ID,
      patternIds: [ID],
      reason: '  Confirmed policy removal  ',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.reason).toBe('Confirmed policy removal');
  });

  it.each([
    [{ batchId: BATCH_ID, patternIds: [], reason: 'Confirmed policy removal' }],
    [{ batchId: BATCH_ID, patternIds: [ID, ID], reason: 'Confirmed policy removal' }],
    [{ batchId: 'not-a-uuid', patternIds: [ID], reason: 'Confirmed policy removal' }],
    [{ batchId: BATCH_ID, patternIds: [ID], reason: ' too short ' }],
  ])('rejects an invalid request payload', async (input) => {
    expect(await errors(input)).not.toHaveLength(0);
  });
});
