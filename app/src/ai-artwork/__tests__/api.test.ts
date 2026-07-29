import { AiCreditShortfallError, generateAiArtwork } from '../api';

jest.mock('@/api/apiFetch', () => ({ apiFetch: jest.fn() }));

const { apiFetch } = require('@/api/apiFetch');

function jsonResponse(status: number, body: unknown): Response {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe('AI artwork client', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps the backend AI Credit shortfall without broadening other conflicts', async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse(409, { message: 'No available AI Credit' }));

    await expect(generateAiArtwork('A garden', 'square'))
      .rejects.toBeInstanceOf(AiCreditShortfallError);

    apiFetch.mockResolvedValueOnce(jsonResponse(409, { message: 'Another conflict' }));
    await expect(generateAiArtwork('A garden', 'square'))
      .rejects.toThrow('Another conflict');
  });
});
