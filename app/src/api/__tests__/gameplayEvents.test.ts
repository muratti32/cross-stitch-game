import { postAnalyticsGameplayEvents } from '../gameplayEvents';

jest.mock('../apiFetch', () => ({
  apiFetch: jest.fn(),
}));

const { apiFetch } = require('../apiFetch') as { apiFetch: jest.Mock };

function response(status: number, body: unknown = { accepted: true }): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('analytics gameplay events API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts the documented envelope to the #60 endpoint', async () => {
    apiFetch.mockResolvedValue(response(202));
    const events = [{
      eventId: '72bb19f7-e78e-4b72-bc75-d761122a25df',
      occurredAt: '2026-07-25T10:00:00.000Z',
      kind: 'session_started' as const,
      payload: { session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5' },
    }];

    await expect(postAnalyticsGameplayEvents(events)).resolves.toBeUndefined();
    expect(apiFetch).toHaveBeenCalledWith('/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
  });

  it('does not accept a non-202 response as an acknowledgement', async () => {
    apiFetch.mockResolvedValue(response(500));

    await expect(postAnalyticsGameplayEvents([])).rejects.toEqual(
      expect.objectContaining({ status: 500 }),
    );
  });

  it('does not treat a malformed 202 response as an acknowledgement', async () => {
    apiFetch.mockResolvedValue(response(202, { accepted: false }));

    await expect(postAnalyticsGameplayEvents([])).rejects.toEqual(
      expect.objectContaining({ status: 202 }),
    );
  });
});
