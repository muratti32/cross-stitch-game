import {
  communityReportValidationError,
  createCommunityReport,
} from '../communityReports';

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

describe('Community Reports client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('requires a reason and an explanation for Other', () => {
    expect(communityReportValidationError({})).toBe('Choose a report reason.');
    expect(communityReportValidationError({ reason: 'other', explanation: '  ' })).toBe(
      'Explain why you are reporting this pattern.',
    );
    expect(
      communityReportValidationError({ reason: 'other', explanation: 'New evidence' }),
    ).toBeNull();
    expect(
      communityReportValidationError({ reason: 'duplicate_or_spam' }),
    ).toBeNull();
    expect(
      communityReportValidationError({
        explanation: '!!!',
        reason: 'duplicate_or_spam',
      }),
    ).toBe('The explanation must include letters or numbers.');
  });

  test('submits normalized input and returns an idempotent result', async () => {
    const result = {
      created: false,
      report: {
        createdAt: '2026-07-24T12:00:00.000Z',
        explanation: 'Evidence',
        id: 'report-id',
        reason: 'duplicate_or_spam',
        reviewId: 'review-id',
      },
      review: {
        id: 'review-id',
        openedAt: '2026-07-24T12:00:00.000Z',
        status: 'open',
      },
    };
    apiFetch.mockResolvedValue(jsonResponse(200, result));

    await expect(
      createCommunityReport('pattern-id', {
        explanation: '  Evidence  ',
        reason: 'duplicate_or_spam',
      }),
    ).resolves.toEqual(result);
    expect(apiFetch).toHaveBeenCalledWith(
      '/v1/catalog/patterns/pattern-id/reports',
      expect.objectContaining({
        body: JSON.stringify({
          explanation: 'Evidence',
          reason: 'duplicate_or_spam',
        }),
        method: 'POST',
      }),
    );
  });

  test('surfaces an actionable backend rejection', async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(409, {
        message: 'Reopening requires newly approved metadata or materially new evidence',
      }),
    );

    await expect(
      createCommunityReport('pattern-id', {
        reason: 'inappropriate_or_unsafe_content',
      }),
    ).rejects.toThrow(
      'Reopening requires newly approved metadata or materially new evidence',
    );
  });
});
