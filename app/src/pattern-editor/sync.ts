import { getPendingPersonalPatterns, removePendingPersonalPattern } from '@/local-db';
import { createDerivedPattern } from './api';

export async function syncPendingPersonalPatterns(): Promise<void> {
  const pending = await getPendingPersonalPatterns();
  for (const record of pending) {
    try {
      await createDerivedPattern({
        patternId: record.patternId,
        sourcePatternId: record.sourcePatternId,
        title: record.title,
        width: record.width,
        height: record.height,
        palette: record.palette,
        grid: record.gridBase64,
      });
      await removePendingPersonalPattern(record.patternId);
    } catch (err) {
      // best effort, try again later (matches syncPendingCancels)
    }
  }
}
