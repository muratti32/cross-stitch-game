import { updateSessionAssetUrls, type StitchingSession } from '@/local-db';

import { listPersonalPatterns } from './api';

/**
 * Re-issues the signed Pattern Thumbnail / Pattern Preview grants for every
 * 'personal' session in the list and persists them.
 *
 * The urls handed to Session Preparation expire after GRANT_TTL_SECONDS, so the
 * copy written into the sessions table goes stale within minutes and the card
 * renders an empty backdrop from then on. Listing the Personal Patterns mints
 * fresh grants for all of them in one round-trip.
 *
 * Returns the same array reference when nothing changed so callers can skip a
 * re-render; throws when the listing fails (offline, guest identity) and leaves
 * the stored urls untouched.
 */
export async function refreshPersonalSessionAssetUrls<T extends StitchingSession>(
  sessions: T[]
): Promise<T[]> {
  const personalPatternIds = new Set(
    sessions.filter((session) => session.source === 'personal').map((session) => session.patternId)
  );
  if (personalPatternIds.size === 0) {
    return sessions;
  }

  const patterns = await listPersonalPatterns();
  const freshUrlsByPatternId = new Map(
    patterns
      .filter((pattern) => personalPatternIds.has(pattern.id))
      .map((pattern) => [
        pattern.id,
        {
          previewUrl: pattern.previewUrl,
          thumbnailUrl: pattern.thumbnailUrls?.browsing ?? null,
        },
      ])
  );
  if (freshUrlsByPatternId.size === 0) {
    return sessions;
  }

  for (const [patternId, urls] of freshUrlsByPatternId) {
    await updateSessionAssetUrls(patternId, 'personal', urls);
  }

  let changed = false;
  const refreshed = sessions.map((session) => {
    if (session.source !== 'personal') {
      return session;
    }
    const urls = freshUrlsByPatternId.get(session.patternId);
    if (
      urls === undefined ||
      (urls.previewUrl === session.previewUrl && urls.thumbnailUrl === session.thumbnailUrl)
    ) {
      return session;
    }
    changed = true;
    return { ...session, previewUrl: urls.previewUrl, thumbnailUrl: urls.thumbnailUrl };
  });

  return changed ? refreshed : sessions;
}

/**
 * Resolves fresh private-image grants before a list first presents its cards.
 * Offline callers retain the cached sessions instead of briefly rendering a
 * stale URL and replacing it in a second visible pass.
 */
export async function refreshPersonalSessionAssetUrlsBeforeRender<T extends StitchingSession>(
  sessions: T[],
  onError?: (error: unknown) => void,
): Promise<T[]> {
  try {
    return await refreshPersonalSessionAssetUrls(sessions);
  } catch (error: unknown) {
    onError?.(error);
    return sessions;
  }
}
