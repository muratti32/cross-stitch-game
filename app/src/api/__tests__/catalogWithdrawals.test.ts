import { withdrawCommunityPattern } from '../catalogWithdrawals';

jest.mock('../apiFetch', () => ({
  apiFetch: jest.fn(),
}));

const { apiFetch } = require('../apiFetch');

function jsonResponse(status: number, body: unknown): Response {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe('Catalog Withdrawal client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('submits an owner withdrawal and returns its immutable audit summary', async () => {
    const result = {
      created: true,
      withdrawal: {
        closedRecords: [],
        createdAt: '2026-07-24T12:00:00.000Z',
        id: 'withdrawal-id',
        patternId: 'pattern-id',
        status: 'withdrawn',
      },
    };
    apiFetch.mockResolvedValue(jsonResponse(201, result));

    await expect(withdrawCommunityPattern('pattern-id')).resolves.toEqual(result);
    expect(apiFetch).toHaveBeenCalledWith(
      '/v1/catalog/patterns/pattern-id/withdraw',
      { method: 'POST' },
    );
  });

  test('surfaces an irreversible-transition rejection', async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(409, {
        message: 'Community Pattern is not available for withdrawal',
      }),
    );

    await expect(withdrawCommunityPattern('pattern-id')).rejects.toThrow(
      'Community Pattern is not available for withdrawal',
    );
  });
});
