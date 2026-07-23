import {
  CreatorProfileApiError,
  createCreatorProfile,
  getMyCreatorProfile,
  updateCreatorProfile,
} from '../creatorProfile';

jest.mock('../apiFetch', () => ({ apiFetch: jest.fn() }));

const { apiFetch } = require('../apiFetch');

function jsonResponse(status: number, body: unknown): Response {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

const profile = {
  avatarUrl: '/v1/creator-profiles/18c048bf-9c47-4f31-a3b0-a1546f77a00a/avatar?v=1',
  createdAt: '2026-07-23T10:00:00.000Z',
  displayName: 'Thread Friend',
  id: '18c048bf-9c47-4f31-a3b0-a1546f77a00a',
  updatedAt: '2026-07-23T10:00:00.000Z',
  username: 'thread_friend',
};

describe('creator profile client', () => {
  beforeEach(() => jest.clearAllMocks());

  test('treats a missing profile as the create state', async () => {
    apiFetch.mockResolvedValue(jsonResponse(404, { message: 'Creator Profile not found' }));

    await expect(getMyCreatorProfile()).resolves.toBeNull();
  });

  test('loads the public view and makes its avatar URL absolute', async () => {
    apiFetch.mockResolvedValue(jsonResponse(200, profile));

    await expect(getMyCreatorProfile()).resolves.toMatchObject({
      avatarUrl: `http://localhost:3000${profile.avatarUrl}`,
      displayName: 'Thread Friend',
      username: 'thread_friend',
    });
  });

  test('creates a profile as multipart text fields', async () => {
    apiFetch.mockResolvedValue(jsonResponse(201, { ...profile, avatarUrl: null }));

    await createCreatorProfile({
      displayName: 'Thread Friend',
      username: 'thread_friend',
    });

    expect(apiFetch).toHaveBeenCalledWith(
      '/v1/creator-profiles',
      expect.objectContaining({ body: expect.any(FormData), method: 'POST' }),
    );
    const request = apiFetch.mock.calls[0][1] as { body: FormData };
    expect(Array.from(request.body.entries())).toEqual(
      expect.arrayContaining([
        ['username', 'thread_friend'],
        ['displayName', 'Thread Friend'],
      ]),
    );
  });

  test('surfaces the safety rejection reason without changing local cached data', async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(422, {
        code: 'PROFILE_SAFETY_REJECTED',
        message: 'Display name contains a reserved name',
        reason: 'Display name contains a reserved name',
      }),
    );

    await expect(
      updateCreatorProfile({ displayName: 'Official', removeAvatar: false }),
    ).rejects.toMatchObject<Partial<CreatorProfileApiError>>({
      reason: 'Display name contains a reserved name',
      status: 422,
    });
  });

  test('sends avatar removal explicitly', async () => {
    apiFetch.mockResolvedValue(jsonResponse(200, { ...profile, avatarUrl: null }));

    await updateCreatorProfile({ displayName: 'Thread Friend', removeAvatar: true });

    const request = apiFetch.mock.calls[0][1] as { body: FormData };
    expect(Array.from(request.body.entries())).toContainEqual(['removeAvatar', 'true']);
  });
});
