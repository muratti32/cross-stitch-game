import { useEffect } from 'react';
import { captureLocalPersistenceError } from '../observability/sentry';
import { deleteOfflinePatternFile } from '../session-preparation';

/**
 * Safety Removal: the on-device Pattern copy goes as soon as the app learns of the
 * removal, not at the next sync. A failed delete is reported, never swallowed.
 */
export function usePatternChartRemoval(patternId: string, removed: boolean): void {
  useEffect(() => {
    if (!removed) return;
    deleteOfflinePatternFile(patternId).catch((error: unknown) => {
      captureLocalPersistenceError('delete-removed-pattern-file', error);
    });
  }, [removed, patternId]);
}
