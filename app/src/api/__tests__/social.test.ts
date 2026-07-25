import { useQueryClient } from '@tanstack/react-query';
import { useLikeToggle, SocialApiError } from '../social';
import { preparePromotionManifest, drainLike } from '../promotion';
import { setLocalPatternLike, getLocalPatternLikes } from '../../local-db';
import { useIdentityStore } from '../../identity/guestIdentity';

// Mock apiFetch
jest.mock('../apiFetch', () => ({
  apiFetch: jest.fn(),
}));
const { apiFetch } = require('../apiFetch');

// Mock local-db exports
jest.mock('../../local-db', () => ({
  setLocalPatternLike: jest.fn(),
  getLocalPatternLikes: jest.fn(),
}));

// Mock react-query hooks
jest.mock('@tanstack/react-query', () => {
  const original = jest.requireActual('@tanstack/react-query');
  return {
    ...original,
    useMutation: jest.fn((config) => config),
    useQueryClient: jest.fn(),
  };
});

// Mock identity store
jest.mock('../../identity/guestIdentity', () => {
  return {
    useIdentityStore: jest.fn(() => ({ isAccount: false })),
  };
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

type LikeVariables = {
  patternId: string;
  currentLiked: boolean;
  currentLikeCount: number;
};

type LikeResult = { liked: boolean; likeCount: number | null };

type LikeContext = {
  previousState: { currentLiked: boolean; currentLikeCount: number };
};

// useMutation is mocked to hand back its own config object, so the hook's
// callbacks can be driven directly without mounting a component tree.
interface LikeMutationConfig {
  mutationFn: (variables: LikeVariables) => Promise<LikeResult>;
  onMutate: (variables: LikeVariables) => Promise<LikeContext>;
  onError: (
    error: Error,
    variables: LikeVariables,
    context: LikeContext | undefined,
  ) => void;
  onSuccess: (data: LikeResult, variables: LikeVariables) => void;
}

function likeMutationConfig(): LikeMutationConfig {
  return useLikeToggle() as unknown as LikeMutationConfig;
}

interface MockQueryClient {
  cancelQueries: jest.Mock;
  setQueriesData: jest.Mock;
  setQueryData: jest.Mock;
  invalidateQueries: jest.Mock;
}

describe('Social API Client', () => {
  let mockQueryClient: MockQueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryClient = {
      cancelQueries: jest.fn(),
      setQueriesData: jest.fn(),
      setQueryData: jest.fn(),
      invalidateQueries: jest.fn(),
    };
    (useQueryClient as jest.Mock).mockReturnValue(mockQueryClient);
  });

  test('a guest like writes only to the local SQLite table and never calls the like endpoint', async () => {
    // 1. Arrange
    (useIdentityStore as unknown as jest.Mock).mockReturnValue({ isAccount: false });
    (setLocalPatternLike as jest.Mock).mockResolvedValue(undefined);

    // 2. Act
    const mutationConfig = likeMutationConfig();
    const result = await mutationConfig.mutationFn({
      patternId: 'p1',
      currentLiked: false,
      currentLikeCount: 10,
    });

    // 3. Assert
    expect(setLocalPatternLike).toHaveBeenCalledWith('p1', true);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(result).toEqual({ liked: true, likeCount: null });
  });

  test('an account like calls PUT /v1/patterns/:id/like and updates the cached likeCount / viewerLiked', async () => {
    // 1. Arrange
    (useIdentityStore as unknown as jest.Mock).mockReturnValue({ isAccount: true });
    apiFetch.mockResolvedValue(jsonResponse(200, { liked: true, likeCount: 11 }));

    // 2. Act
    const mutationConfig = likeMutationConfig();
    const result = await mutationConfig.mutationFn({
      patternId: 'p1',
      currentLiked: false,
      currentLikeCount: 10,
    });

    // 3. Assert
    expect(apiFetch).toHaveBeenCalledWith('/v1/patterns/p1/like', { method: 'PUT' });
    expect(result).toEqual({ liked: true, likeCount: 11 });

    // Test optimistic update onMutate
    const context = await mutationConfig.onMutate({
      patternId: 'p1',
      currentLiked: false,
      currentLikeCount: 10,
    });
    expect(context).toEqual({ previousState: { currentLiked: false, currentLikeCount: 10 } });
    expect(mockQueryClient.cancelQueries).toHaveBeenCalled();
    expect(mockQueryClient.setQueriesData).toHaveBeenCalled();
  });

  test('a failed account like rolls the optimistic update back and exposes the error', async () => {
    // 1. Arrange
    (useIdentityStore as unknown as jest.Mock).mockReturnValue({ isAccount: true });
    apiFetch.mockResolvedValue(jsonResponse(400, { message: 'Bad request' }));

    // 2. Act & Assert
    const mutationConfig = likeMutationConfig();
    // The rejection is what carries the failure into the mutation's `error`,
    // which the screens render — it must not be swallowed.
    const rejection = mutationConfig.mutationFn({
      patternId: 'p1',
      currentLiked: false,
      currentLikeCount: 10,
    });
    await expect(rejection).rejects.toBeInstanceOf(SocialApiError);
    await expect(rejection).rejects.toThrow('Bad request');

    await mutationConfig.onMutate({
      patternId: 'p1',
      currentLiked: false,
      currentLikeCount: 10,
    });
    const writesAfterOptimisticUpdate = mockQueryClient.setQueriesData.mock.calls.length;

    // Trigger onError to test rollback
    mutationConfig.onError(
      new SocialApiError(400, 'Bad request', null),
      { patternId: 'p1', currentLiked: false, currentLikeCount: 10 },
      { previousState: { currentLiked: false, currentLikeCount: 10 } }
    );

    expect(mockQueryClient.setQueriesData.mock.calls.length).toBeGreaterThan(
      writesAfterOptimisticUpdate
    );
  });

  test('getLocalPatternLikes() feeds the promotion manifest, and a successful drainLike clears that local row', async () => {
    // 1. Arrange getLocalPatternLikes
    (getLocalPatternLikes as jest.Mock).mockResolvedValue({ p1: true });

    // 2. Act preparePromotionManifest
    const manifest = await preparePromotionManifest();
    expect(manifest.likes).toEqual({ p1: true });

    // 3. Arrange drainLike success
    apiFetch.mockResolvedValue(jsonResponse(200, { success: true }));
    (setLocalPatternLike as jest.Mock).mockResolvedValue(undefined);

    // 4. Act drainLike
    await drainLike('guest_123', 'p1');

    // 5. Assert
    expect(apiFetch).toHaveBeenCalledWith(
      '/v1/promotion/drain/like',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ guestId: 'guest_123', patternId: 'p1' }),
      })
    );
    expect(setLocalPatternLike).toHaveBeenCalledWith('p1', false);
  });
});
