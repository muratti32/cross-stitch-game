import { listModerationNotices } from '../moderationNotices';

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

describe('Moderation Notices client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads owner-visible notices without reporter details', async () => {
    const notices = [
      {
        createdAt: '2026-07-24T12:00:00.000Z',
        id: 'notice-id',
        noticeType: 'review_hold',
        patternId: 'pattern-id',
        patternTitle: 'Held Pattern',
        reason: 'A moderator is reviewing the reported catalog content.',
      },
    ];
    apiFetch.mockResolvedValue(jsonResponse(200, notices));

    await expect(listModerationNotices()).resolves.toEqual(notices);
    expect(apiFetch).toHaveBeenCalledWith('/v1/moderation-notices');
    expect(JSON.stringify(notices)).not.toContain('reporter');
  });

  test('surfaces the backend failure reason', async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(403, { message: 'Registered Account required' }),
    );
    await expect(listModerationNotices()).rejects.toThrow(
      'Registered Account required',
    );
  });
});
