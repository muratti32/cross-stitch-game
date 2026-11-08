import * as FileSystem from 'expo-file-system/legacy';
import { requestPatternChartArtifactGrant } from '../api/patternCharts';
import { Config } from '../config';
import { getActiveIdentity, getSessions } from '../local-db';
import { base64ToUint8Array } from '../local-db/helpers';
import { decodePatternArtifact } from '../pattern-artifact';
import { getOfflinePatternPath } from '../session-preparation';
import type { ChartSourceDeps } from './loadChartPattern';

export const chartSourceDeps: ChartSourceDeps = {
  async readOffline(patternId) {
    const path = getOfflinePatternPath(patternId, getActiveIdentity());
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
    return base64ToUint8Array(base64);
  },
  async requestGrant(patternId) {
    const grant = await requestPatternChartArtifactGrant(patternId);
    return { url: grant.grant.url, checksum: grant.artifact.checksum };
  },
  async download(grantUrl) {
    const url = grantUrl.startsWith('http') ? grantUrl : `${Config.apiBaseUrl}${grantUrl}`;
    const temp = `${FileSystem.cacheDirectory}pattern-chart-artifact-${Date.now()}.tmp`;
    try {
      const result = await FileSystem.downloadAsync(url, temp);
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Pattern artifact download failed: ${result.status}`);
      }
      const base64 = await FileSystem.readAsStringAsync(result.uri, { encoding: FileSystem.EncodingType.Base64 });
      return base64ToUint8Array(base64);
    } finally {
      await FileSystem.deleteAsync(temp, { idempotent: true });
    }
  },
  decode: decodePatternArtifact,
};

/** Checksum of the newest Pattern Artifact this device holds for a pattern, from its Stitching Sessions. */
export async function findLocalArtifactChecksum(patternId: string): Promise<string | null> {
  const sessions = await getSessions();
  const match = sessions
    .filter((session) => session.patternId === patternId && session.status !== 'preparing')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return match?.artifactChecksum ?? null;
}
