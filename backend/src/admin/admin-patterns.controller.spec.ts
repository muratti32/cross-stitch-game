import { AdminPatternsController } from './admin-patterns.controller';

describe('AdminPatternsController bulk removal API', () => {
  it('returns the durable original result exposed by the service on retry', async () => {
    const result = {
      batchId: '00000000-0000-4000-8000-000000000099',
      patternIds: [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ],
      removedCount: 2,
    };
    const adminCatalog = { bulkRemovePatterns: jest.fn().mockResolvedValue(result) };
    const controller = new AdminPatternsController(adminCatalog as never);
    const body = {
      batchId: result.batchId,
      patternIds: [...result.patternIds].reverse(),
      reason: 'Confirmed policy removal',
    };

    await expect(controller.bulkRemove(
      { id: 'operator-id' } as never,
      body,
      'retry-request-id',
    )).resolves.toEqual(result);
    expect(adminCatalog.bulkRemovePatterns).toHaveBeenCalledWith(
      'operator-id', body.patternIds, body.reason, body.batchId, 'retry-request-id',
    );
  });
});
