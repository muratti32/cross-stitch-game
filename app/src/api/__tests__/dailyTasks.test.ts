import { postGameplayEvents, DailyTaskSyncError } from '../dailyTasks';

// Mock the authenticated fetch wrapper so no network/identity is touched.
jest.mock('../apiFetch', () => ({
  apiFetch: jest.fn(),
}));

const { apiFetch } = require('../apiFetch');

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('dailyTasks economy client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('postGameplayEvents resolves on 201', async () => {
    apiFetch.mockResolvedValue(jsonResponse(201, {}));

    const mockPayload = [
      {
        eventId: 'e1',
        kind: 'stitch_action' as const,
        sessionId: 's1',
        dmcCode: '310',
        clientSeq: 1,
        occurredAt: '2026-07-22T10:41:52Z',
      },
    ];

    await expect(postGameplayEvents(mockPayload)).resolves.toBeUndefined();

    expect(apiFetch).toHaveBeenCalledWith(
      '/v1/economy/daily-tasks/events',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ events: mockPayload }),
      }),
    );
  });

  test('postGameplayEvents throws DailyTaskSyncError carrying the status on any non-201 status', async () => {
    apiFetch.mockResolvedValue(jsonResponse(403, { message: 'Guest account forbidden' }));

    const mockPayload = [
      {
        eventId: 'e1',
        kind: 'stitch_action' as const,
        sessionId: 's1',
        dmcCode: '310',
        clientSeq: 1,
        occurredAt: '2026-07-22T10:41:52Z',
      },
    ];

    await expect(postGameplayEvents(mockPayload)).rejects.toThrow(
      'Gameplay event flush failed: status 403',
    );
    await expect(postGameplayEvents(mockPayload)).rejects.toBeInstanceOf(DailyTaskSyncError);
    await expect(postGameplayEvents(mockPayload)).rejects.toMatchObject({
      status: 403,
    });
  });

  test('postGameplayEvents throws on 400 status', async () => {
    apiFetch.mockResolvedValue(jsonResponse(400, { message: 'Bad request' }));

    const mockPayload = [
      {
        eventId: 'e1',
        kind: 'stitch_action' as const,
        sessionId: 's1',
        dmcCode: '310',
        clientSeq: 1,
        occurredAt: '2026-07-22T10:41:52Z',
      },
    ];

    await expect(postGameplayEvents(mockPayload)).rejects.toThrow(
      'Gameplay event flush failed: status 400',
    );
  });
});
