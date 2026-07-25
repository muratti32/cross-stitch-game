import { useMutation, useQuery, useQueryClient, useInfiniteQuery, QueryClient, InfiniteData } from '@tanstack/react-query';
import { apiFetch } from './apiFetch';
import { CatalogPatternItem, CatalogPage, CachedResult } from './catalog';
import { getSurfaceKey } from '../catalog-cache-logic';
import { setLocalPatternLike, getLocalPatternLikes } from '../local-db';
import { useIdentityStore } from '../identity/guestIdentity';

export interface BlockedCreator {
  id: string;
  username: string;
  displayName: string;
}

export class SocialApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = 'SocialApiError';
  }
}

async function parseSocialError(response: Response, fallback: string): Promise<SocialApiError> {
  let message = fallback;
  let reason: string | null = null;
  try {
    const body = (await response.json()) as { message?: unknown; reason?: unknown };
    if (typeof body.message === 'string') message = body.message;
    if (Array.isArray(body.message)) {
      message = body.message.filter((item): item is string => typeof item === 'string').join(', ');
    }
    if (typeof body.reason === 'string') reason = body.reason;
  } catch {
    // ignore
  }
  return new SocialApiError(response.status, message, reason);
}

function updateQueriesWithPattern(
  queryClient: QueryClient,
  patternId: string,
  nextLiked: boolean,
  nextLikeCount: number
) {
  // 1. Update single pattern detail
  queryClient.setQueriesData<CachedResult<CatalogPatternItem> | undefined>(
    { queryKey: ['catalog', 'pattern', patternId] },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        data: {
          ...old.data,
          viewerLiked: nextLiked,
          likeCount: nextLikeCount,
        },
      };
    }
  );

  // 2. Update staff picks (CachedResult<CatalogPatternItem[]>)
  queryClient.setQueriesData<CachedResult<CatalogPatternItem[]> | undefined>(
    { queryKey: ['catalog', 'staff-picks'] },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        data: old.data.map((item) =>
          item.id === patternId
            ? { ...item, viewerLiked: nextLiked, likeCount: nextLikeCount }
            : item
        ),
      };
    }
  );

  // 3. Update search queries (CatalogPatternItem[])
  queryClient.setQueriesData<CatalogPatternItem[] | undefined>(
    { queryKey: ['catalog', 'search'] },
    (old) => {
      if (!old) return old;
      return old.map((item) =>
        item.id === patternId
          ? { ...item, viewerLiked: nextLiked, likeCount: nextLikeCount }
          : item
      );
    }
  );

  // 4. Update infinite queries like new patterns and browse
  const updateInfinitePage = (
    old: InfiniteData<CachedResult<CatalogPage>> | undefined
  ): InfiniteData<CachedResult<CatalogPage>> | undefined => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((page: CachedResult<CatalogPage>) => ({
        ...page,
        data: {
          ...page.data,
          items: page.data.items.map((item: CatalogPatternItem) =>
            item.id === patternId
              ? { ...item, viewerLiked: nextLiked, likeCount: nextLikeCount }
              : item
          ),
        },
      })),
    };
  };

  queryClient.setQueriesData({ queryKey: ['catalog', 'new'] }, updateInfinitePage);
  queryClient.setQueriesData({ queryKey: ['catalog', 'browse'] }, updateInfinitePage);

  // 5. Update liked patterns infinite query
  queryClient.setQueriesData<InfiniteData<CatalogPage> | undefined>(
    { queryKey: ['me', 'liked-patterns'] },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page: CatalogPage) => ({
          ...page,
          items: page.items.map((item: CatalogPatternItem) =>
            item.id === patternId
              ? { ...item, viewerLiked: nextLiked, likeCount: nextLikeCount }
              : item
          ),
        })),
      };
    }
  );
}

export function useLocalLikes() {
  return useQuery<Record<string, boolean>>({
    queryKey: ['local-likes'],
    queryFn: getLocalPatternLikes,
  });
}

export function useLikeToggle() {
  const queryClient = useQueryClient();
  const { isAccount } = useIdentityStore();

  return useMutation({
    mutationFn: async ({
      patternId,
      currentLiked,
    }: {
      patternId: string;
      currentLiked: boolean;
      currentLikeCount: number;
    }) => {
      const nextLiked = !currentLiked;
      if (isAccount) {
        const method = nextLiked ? 'PUT' : 'DELETE';
        const response = await apiFetch(`/v1/patterns/${patternId}/like`, { method });
        if (!response.ok) {
          throw await parseSocialError(response, 'Failed to toggle like');
        }
        return (await response.json()) as { liked: boolean; likeCount: number };
      } else {
        await setLocalPatternLike(patternId, nextLiked);
        return { liked: nextLiked, likeCount: null };
      }
    },
    onMutate: async ({ patternId, currentLiked, currentLikeCount }): Promise<{ previousState: { currentLiked: boolean; currentLikeCount: number } }> => {
      await queryClient.cancelQueries({ queryKey: ['catalog'] });
      await queryClient.cancelQueries({ queryKey: ['me', 'liked-patterns'] });
      await queryClient.cancelQueries({ queryKey: ['local-likes'] });

      const previousState = { currentLiked, currentLikeCount };

      const nextLiked = !currentLiked;
      const nextLikeCount = isAccount
        ? (nextLiked ? currentLikeCount + 1 : Math.max(0, currentLikeCount - 1))
        : currentLikeCount;

      updateQueriesWithPattern(queryClient, patternId, nextLiked, nextLikeCount);

      if (!isAccount) {
        queryClient.setQueryData<Record<string, boolean>>(['local-likes'], (old) => {
          return {
            ...old,
            [patternId]: nextLiked,
          };
        });
      }

      return { previousState };
    },
    onError: (
      _err: Error,
      variables: { patternId: string; currentLiked: boolean; currentLikeCount: number },
      context: { previousState?: { currentLiked: boolean; currentLikeCount: number } } | undefined
    ) => {
      if (context?.previousState) {
        const { currentLiked, currentLikeCount } = context.previousState;
        updateQueriesWithPattern(
          queryClient,
          variables.patternId,
          currentLiked,
          currentLikeCount
        );

        if (!isAccount) {
          queryClient.setQueryData<Record<string, boolean>>(['local-likes'], (old) => {
            return {
              ...old,
              [variables.patternId]: currentLiked,
            };
          });
        }
      }
    },
    onSuccess: (
      data: { liked: boolean; likeCount: number | null },
      variables: { patternId: string; currentLiked: boolean; currentLikeCount: number }
    ) => {
      if (isAccount && data.likeCount !== null && data.likeCount !== undefined) {
        updateQueriesWithPattern(
          queryClient,
          variables.patternId,
          data.liked,
          data.likeCount
        );
      }
      queryClient.invalidateQueries({ queryKey: ['me', 'liked-patterns'] });
      queryClient.invalidateQueries({ queryKey: ['local-likes'] });
    },
  });
}

export function useLikedPatterns(locale = 'en') {
  const { isAccount } = useIdentityStore();
  return useInfiniteQuery<CatalogPage>({
    queryKey: ['me', 'liked-patterns', locale],
    enabled: isAccount,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as string | null;
      const url = getSurfaceKey('/v1/me/liked-patterns', {
        cursor: cursor ?? undefined,
        limit: 10,
        locale,
      });
      const response = await apiFetch(url);
      if (!response.ok) {
        throw await parseSocialError(response, 'Failed to fetch liked patterns');
      }
      return (await response.json()) as CatalogPage;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useCreatorBlocks() {
  const { isAccount } = useIdentityStore();
  return useQuery<BlockedCreator[]>({
    queryKey: ['creator-blocks'],
    enabled: isAccount,
    queryFn: async () => {
      const response = await apiFetch('/v1/creator-blocks');
      if (!response.ok) {
        throw await parseSocialError(response, 'Failed to fetch blocked creators');
      }
      return (await response.json()) as BlockedCreator[];
    },
  });
}

export function useBlockCreator() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (creatorProfileId: string) => {
      const response = await apiFetch(`/v1/creator-blocks/${creatorProfileId}`, {
        method: 'PUT',
      });
      if (!response.ok) {
        throw await parseSocialError(response, 'Failed to block creator');
      }
      return (await response.json()) as { blocked: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creator-blocks'] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
    },
  });
}

export function useUnblockCreator() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (creatorProfileId: string) => {
      const response = await apiFetch(`/v1/creator-blocks/${creatorProfileId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw await parseSocialError(response, 'Failed to unblock creator');
      }
      return (await response.json()) as { blocked: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creator-blocks'] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
    },
  });
}
